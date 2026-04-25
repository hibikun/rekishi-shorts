import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  type AudioClip,
  type Scene,
  type Script,
} from "@rekishi/shared";
import { synthesizeNarration, probeDurationSec } from "./tts-generator.js";

// ========================================================================
// セグメント別 TTS で ranking three-pick の narration を組み立てるパイプライン。
// 案G改: 5 narrator clips (Kore) + 9 reviewer clips (3 voices rotate) → ffmpeg concat
//        → audioClips manifest と 8 scenes を返す。scene-aligner は不要。
// ========================================================================

const DEFAULT_NARRATOR_VOICE = "Kore";
const DEFAULT_REVIEWER_VOICES = ["Puck", "Aoede", "Leda"] as const;
const DEFAULT_CONCURRENCY = 4;

export interface SynthesizeRankingClipsInput {
  script: Script;
  /** 個別クリップを置くディレクトリ（jobPaths.ttsClipsDir 等） */
  clipsDir: string;
  /** 結合 narration.wav の出力先 */
  combinedOutPath: string;
  /** narrator (5枠 共通) のボイス。デフォルト Kore */
  narratorVoice?: string;
  /** reviewer のボイス列。reviewIndex 0/1/2 でローテーション。デフォルト Puck/Aoede/Leda */
  reviewerVoices?: readonly string[];
  /** 同時 TTS 数。デフォルト 4 */
  concurrency?: number;
  /** 台本 readings (TTS 誤読防止) */
  readings?: Record<string, string>;
  /** 固定辞書 furigana */
  furigana?: Record<string, string>;
}

export interface SynthesizeRankingClipsResult {
  /** 結合済み narration.wav の絶対パス */
  combinedPath: string;
  /** 結合 wav の真の長さ (ffprobe 計測) */
  totalDurationSec: number;
  /** 14 クリップ分のマニフェスト */
  audioClips: AudioClip[];
  /** 8 シーン (scene-aligner skip 用) */
  scenes: Scene[];
  /** 合計課金文字数 */
  characters: number;
  /** Gemini 使用量集計 */
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
}

const AUDIO_CLIPS_MANIFEST_VERSION = 1;
const AUDIO_CLIPS_MANIFEST_MODE = "segment-ranking-tts";

export interface AudioClipsManifest {
  version: typeof AUDIO_CLIPS_MANIFEST_VERSION;
  mode: typeof AUDIO_CLIPS_MANIFEST_MODE;
  /** script.json の sha256。手編集後の古い manifest 誤用を防ぐ */
  scriptHash: string;
  /** 結合済み narration.wav の sha256。単一ボイス再生成後の古い manifest 誤用を防ぐ */
  combinedAudioHash: string;
  totalDurationSec: number;
  audioClips: AudioClip[];
}

export interface AudioClipsManifestHashes {
  scriptHash: string;
  combinedAudioHash: string;
}

/**
 * narration セグメント (5) と items[].reviews (9) を Gemini TTS で個別合成し、
 * 結合した 1 本の narration.wav と各クリップのタイミングメタを返す。
 *
 * 並列度は concurrency でコントロール (デフォルト 4)。
 * 14 本の Gemini API call を直列で走らせると遅すぎる一方、無制限並列だと
 * レート制限に当たりやすいため、固定上限の単純セマフォで揃える。
 */
export async function synthesizeRankingClips(
  input: SynthesizeRankingClipsInput,
): Promise<SynthesizeRankingClipsResult> {
  const { script } = input;
  if (!script.narrationSegments || script.narrationSegments.length === 0) {
    throw new Error(
      "synthesizeRankingClips: script.narrationSegments が必要です（5枠の narrator セグメント）",
    );
  }
  if (!script.items || script.items.length < 3) {
    throw new Error(
      `synthesizeRankingClips: script.items が 3 件必要です (got ${script.items?.length ?? 0})`,
    );
  }

  const narratorVoice = input.narratorVoice ?? DEFAULT_NARRATOR_VOICE;
  const reviewerVoices =
    input.reviewerVoices && input.reviewerVoices.length > 0
      ? input.reviewerVoices
      : DEFAULT_REVIEWER_VOICES;
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY);

  await fsp.mkdir(input.clipsDir, { recursive: true });
  await fsp.mkdir(path.dirname(input.combinedOutPath), { recursive: true });

  // --- jobs を組み立てる ---------------------------------------------------
  // シーン順に並べた合成ジョブ。後で順序を保ったまま並列実行 → 累積 startSec を割り当てる。
  type Job = {
    /** AudioClip の kind と同義 */
    kind: AudioClip["kind"];
    rank?: 1 | 2 | 3;
    reviewIndex?: 0 | 1 | 2;
    voice: string;
    text: string;
    /** クリップ wav の保存先 */
    outPath: string;
    /** scene index (0..7) */
    sceneIndex: number;
    persona: "narrator" | "reviewer";
  };

  const jobs: Job[] = [];

  const segByKind = new Map(script.narrationSegments.map((s) => [s.kind, s.text]));
  const requireSeg = (kind: string): string => {
    const v = segByKind.get(kind as never);
    if (!v) {
      throw new Error(
        `synthesizeRankingClips: narrationSegments に kind="${kind}" がありません`,
      );
    }
    return v;
  };

  // scene 0: opening narrator
  jobs.push({
    kind: "opening",
    voice: narratorVoice,
    text: requireSeg("opening"),
    outPath: path.join(input.clipsDir, "00-opening.wav"),
    sceneIndex: 0,
    persona: "narrator",
  });

  // scene 1/3/5: rank-intro narrator (rank 3 → 2 → 1 の順)
  // scene 2/4/6: rank-review (3 reviews × voice rotate)
  const rankOrder: Array<{ rank: 1 | 2 | 3; sceneIntroIdx: number; sceneReviewIdx: number }> = [
    { rank: 3, sceneIntroIdx: 1, sceneReviewIdx: 2 },
    { rank: 2, sceneIntroIdx: 3, sceneReviewIdx: 4 },
    { rank: 1, sceneIntroIdx: 5, sceneReviewIdx: 6 },
  ];

  for (const { rank, sceneIntroIdx, sceneReviewIdx } of rankOrder) {
    jobs.push({
      kind: "rank-intro",
      rank,
      voice: narratorVoice,
      text: requireSeg(`rank${rank}-intro`),
      outPath: path.join(input.clipsDir, `${pad2(sceneIntroIdx)}-rank${rank}-intro.wav`),
      sceneIndex: sceneIntroIdx,
      persona: "narrator",
    });

    const item = script.items.find((x) => x.rank === rank);
    if (!item) {
      throw new Error(`synthesizeRankingClips: script.items に rank=${rank} がありません`);
    }
    if (!item.reviews || item.reviews.length !== 3) {
      throw new Error(
        `synthesizeRankingClips: items[rank=${rank}].reviews は 3 件必要 (got ${item.reviews?.length ?? 0})`,
      );
    }

    for (let i = 0; i < 3; i++) {
      const reviewIndex = i as 0 | 1 | 2;
      jobs.push({
        kind: "review",
        rank,
        reviewIndex,
        voice: reviewerVoices[i % reviewerVoices.length]!,
        text: item.reviews[i]!,
        outPath: path.join(
          input.clipsDir,
          `${pad2(sceneReviewIdx)}-rank${rank}-review-${i + 1}.wav`,
        ),
        sceneIndex: sceneReviewIdx,
        persona: "reviewer",
      });
    }
  }

  // scene 7: closing narrator
  jobs.push({
    kind: "closing",
    voice: narratorVoice,
    text: requireSeg("closing"),
    outPath: path.join(input.clipsDir, "07-closing.wav"),
    sceneIndex: 7,
    persona: "narrator",
  });

  if (jobs.length !== 14) {
    throw new Error(
      `synthesizeRankingClips: jobs.length=${jobs.length} (expected 14: 5 narrator + 9 review)`,
    );
  }

  // --- 並列合成 -------------------------------------------------------------
  // 各 job を Gemini TTS に投げる。順序は jobs 配列のまま保つため、結果は同じ index に格納する。
  type SynthOutput = {
    durationSec: number;
    characters: number;
    usage: { inputTokens: number; outputTokens: number; model: string };
  };
  const synthResults: SynthOutput[] = new Array(jobs.length);

  await runWithConcurrency(
    jobs.map((job, idx) => async () => {
      const tts = await synthesizeNarration(job.text, job.outPath, {
        readings: input.readings,
        furigana: input.furigana,
        voiceName: job.voice,
        persona: job.persona,
      });
      synthResults[idx] = {
        durationSec: tts.approxDurationSec,
        characters: tts.characters,
        usage: tts.usage,
      };
    }),
    concurrency,
  );

  // --- ffmpeg concat --------------------------------------------------------
  // 全クリップは tts-generator.loudnormInPlace で 24000Hz / mono / pcm_s16le に揃っているため、
  // concat demuxer + -c copy で安全に連結できる。
  await ffmpegConcatWavs(
    jobs.map((j) => j.outPath),
    input.combinedOutPath,
  );
  const probedTotal = await probeDurationSec(input.combinedOutPath);
  const totalDurationSec =
    probedTotal ??
    synthResults.reduce((s, r) => s + r.durationSec, 0);

  // --- audioClips マニフェスト + scenes 8 個 を構築 ------------------------
  const audioClips: AudioClip[] = [];
  let cursor = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const dur = synthResults[i]!.durationSec;
    const startSec = round3(cursor);
    cursor += dur;
    const endSec = round3(cursor);
    audioClips.push({
      kind: job.kind,
      rank: job.rank,
      reviewIndex: job.reviewIndex,
      voice: job.voice,
      path: job.outPath,
      durationSec: round3(dur),
      startSec,
      endSec,
    });
  }

  // ここまで来た時点で script.items は 3 件以上に絞り込み済み
  const scenes = buildScenesFromAudioClips(
    script as Script & { items: NonNullable<Script["items"]> },
    audioClips,
  );

  // 合計使用量（粗い集計）
  const characters = synthResults.reduce((s, r) => s + r.characters, 0);
  const totalIn = synthResults.reduce((s, r) => s + r.usage.inputTokens, 0);
  const totalOut = synthResults.reduce((s, r) => s + r.usage.outputTokens, 0);
  const model = synthResults[0]?.usage.model ?? "gemini-3.1-flash-tts-preview";

  return {
    combinedPath: input.combinedOutPath,
    totalDurationSec,
    audioClips,
    scenes,
    characters,
    usage: {
      inputTokens: totalIn,
      outputTokens: totalOut,
      model,
    },
  };
}

/**
 * audio-clips.json をディスクに書き出す。job dir 内に置いて、
 * build-ranking-plan が後で読み込める形にする。
 */
export function writeAudioClipsJson(
  audioClips: AudioClip[],
  totalDurationSec: number,
  destPath: string,
  hashes: AudioClipsManifestHashes,
): void {
  const manifest: AudioClipsManifest = {
    version: AUDIO_CLIPS_MANIFEST_VERSION,
    mode: AUDIO_CLIPS_MANIFEST_MODE,
    ...hashes,
    totalDurationSec,
    audioClips,
  };
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(
    destPath,
    JSON.stringify(manifest, null, 2),
  );
}

/**
 * audio-clips.json を読み込む。存在しない/現在の script・audio と一致しない場合は null。
 */
export function readAudioClipsJson(
  filePath: string,
  expectedHashes?: AudioClipsManifestHashes,
): AudioClipsManifest | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (raw?.version !== AUDIO_CLIPS_MANIFEST_VERSION) return null;
  if (raw?.mode !== AUDIO_CLIPS_MANIFEST_MODE) return null;
  if (typeof raw?.scriptHash !== "string") return null;
  if (typeof raw?.combinedAudioHash !== "string") return null;
  if (typeof raw?.totalDurationSec !== "number") return null;
  if (!Array.isArray(raw?.audioClips)) return null;
  if (
    expectedHashes &&
    (raw.scriptHash !== expectedHashes.scriptHash ||
      raw.combinedAudioHash !== expectedHashes.combinedAudioHash)
  ) {
    return null;
  }
  return raw as AudioClipsManifest;
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * 8 個の scenes を audioClips から構築する。
 * scene[i].durationSec はその scene に属する全クリップの合計秒。
 * narration / imageQuery 系は plan/RankingShort 側ではほぼ参照されないため、
 * デバッグしやすいよう簡易な値を入れる。
 */
function buildScenesFromAudioClips(
  script: Script & { items: NonNullable<Script["items"]> },
  audioClips: AudioClip[],
): Scene[] {
  const scenes: Scene[] = [];
  const segText = (kind: string): string => {
    const seg = script.narrationSegments?.find((s) => s.kind === kind);
    return seg?.text ?? "";
  };
  const reviewText = (rank: 1 | 2 | 3): string => {
    const item = script.items!.find((x) => x.rank === rank);
    return item?.reviews?.join(" / ") ?? "";
  };

  // scene index → このシーンに属する audioClip を抽出するヘルパ
  const sumDur = (predicate: (c: AudioClip) => boolean): number => {
    const sum = audioClips.filter(predicate).reduce((s, c) => s + c.durationSec, 0);
    return Math.max(0.01, round3(sum));
  };

  // scene 0 opening
  scenes.push({
    index: 0,
    narration: segText("opening"),
    imageQueryJa: "",
    imageQueryEn: "",
    imagePromptEn: "",
    durationSec: sumDur((c) => c.kind === "opening"),
  });
  // scene 1/3/5: rank-intro
  // scene 2/4/6: rank-review
  let sceneIdx = 1;
  for (const rank of [3, 2, 1] as const) {
    scenes.push({
      index: sceneIdx++,
      narration: segText(`rank${rank}-intro`),
      imageQueryJa: "",
      imageQueryEn: "",
      imagePromptEn: "",
      durationSec: sumDur((c) => c.kind === "rank-intro" && c.rank === rank),
    });
    scenes.push({
      index: sceneIdx++,
      narration: reviewText(rank),
      imageQueryJa: "",
      imageQueryEn: "",
      imagePromptEn: "",
      durationSec: sumDur((c) => c.kind === "review" && c.rank === rank),
    });
  }
  // scene 7 closing
  scenes.push({
    index: 7,
    narration: segText("closing"),
    imageQueryJa: "",
    imageQueryEn: "",
    imagePromptEn: "",
    durationSec: sumDur((c) => c.kind === "closing"),
  });

  return scenes;
}

// ========================================================================
// ユーティリティ
// ========================================================================

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}

/**
 * 単純な並列実行リミッタ。p-limit を入れずに jobs 配列を limit 並列で回す。
 * 順序は jobs の index 通りに、各タスクが終わり次第空きスロットへ次を投入する。
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      results[idx] = await tasks[idx]!();
    }
  };
  const n = Math.max(1, Math.min(limit, tasks.length));
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/**
 * 同形式 (24000Hz / mono / pcm_s16le) の wav 群を ffmpeg concat demuxer で 1 本に結合する。
 */
async function ffmpegConcatWavs(inputs: string[], outPath: string): Promise<void> {
  if (inputs.length === 0) {
    throw new Error("ffmpegConcatWavs: inputs is empty");
  }
  const listFile = path.join(
    await fsp.mkdtemp(path.join(os.tmpdir(), "ranking-tts-concat-")),
    "list.txt",
  );
  const body = inputs
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fsp.writeFile(listFile, body, "utf-8");

  await runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c",
    "copy",
    outPath,
  ]);

  await fsp.rm(path.dirname(listFile), { recursive: true, force: true });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });
}
