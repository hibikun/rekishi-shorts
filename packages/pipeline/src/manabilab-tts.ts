/**
 * 学びラボ Plan-driven TTS + 字幕アライン パイプライン。
 *
 * Plan JSON を Single Source of Truth として:
 *   1. scenes[*].narration を scene ごとに VOICEVOX で wav 生成
 *   2. 各 scene wav の実測尺を累積して scene start/end を決定
 *   3. scene wav を 1 本の narration wav に連結
 *   4. plan.totalDurationSec / scenes[*].startSec/endSec を上書き保存
 *
 * これにより Whisper/VAD の境界推定に依存せず、スライド境界を
 * 「実際にその scene の TTS が終わった時刻」に一致させる。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { synthesizeNarrationVoicevox } from "./tts-generator.js";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../",
);

interface PlanReading {
  term: string;
  reading: string;
}

interface PlanAudio {
  path: string;
  voiceProvider: string;
  voiceId?: number;
  voiceName?: string;
  speedScale?: number;
  intonationScale?: number;
}

interface ImageScene {
  index: number;
  kind: "image";
  beat: string;
  startSec: number;
  endSec: number;
  narration: string;
  imagePath: string;
  assetKind?: "character" | "broll";
  overlay?: unknown;
  seedancePrompt: string;
  approved: boolean;
}

interface TitleCardScene {
  index: number;
  kind: "title-card";
  beat: string;
  startSec: number;
  endSec: number;
  narration: string;
  approved: boolean;
}

type SceneSpec = ImageScene | TitleCardScene;

interface ManabilabPlan {
  id: string;
  title: string;
  totalDurationSec: number;
  audio: PlanAudio;
  scenes: SceneSpec[];
  readings?: PlanReading[];
}

export interface GeneratePlanTtsOptions {
  /** チャンネル slug。default "manabilab" */
  channelSlug?: string;
  /** VOICEVOX engine の baseUrl。default http://127.0.0.1:50021 */
  voicevoxBaseUrl?: string;
  /** 進捗ログコールバック */
  onProgress?: (msg: string) => void;
  /** true なら TTS だけ実行し、plan 上書きはスキップ */
  skipAlignment?: boolean;
}

export interface GeneratePlanTtsResult {
  /** 相対パス（plan.audio.path と同じ） */
  audioPath: string;
  /** 絶対パス */
  audioAbsPath: string;
  /** 連結後の wav 総尺 */
  totalDurationSec: number;
  /** 連結後の総文字数 */
  characters: number;
  /** 各シーンの aligned timing */
  scenes: Array<{
    index: number;
    startSec: number;
    endSec: number;
    durationSec: number;
  }>;
  /** 互換フィールド。scene-segmented TTS では Whisper guard を使わないため常に false */
  brokenByGuard: boolean;
  /** alignment 品質シグナル（debug 用） */
  qualityReasons: string[];
}

/**
 * 文字列の長さを「空白を除いた可視文字数」で返す。
 * 句点・読点・英字・数字も全て1文字として数える。
 */
function charLen(s: string): number {
  return s.replace(/\s+/g, "").length;
}

interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  data: Buffer;
}

function readPcmWav(buf: Buffer, filepath: string): WavInfo {
  if (
    buf.length < 12 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`not a RIFF/WAVE file: ${filepath}`);
  }

  let offset = 12;
  let fmt: Omit<WavInfo, "data"> | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        bitsPerSample: buf.readUInt16LE(start + 14),
      };
    } else if (chunkId === "data") {
      data = buf.subarray(start, start + chunkSize);
    }
    offset = start + chunkSize + (chunkSize % 2);
  }

  if (!fmt) throw new Error(`fmt chunk not found: ${filepath}`);
  if (!data) throw new Error(`data chunk not found: ${filepath}`);
  if (fmt.audioFormat !== 1) {
    throw new Error(`unsupported wav format ${fmt.audioFormat}: ${filepath}`);
  }
  return { ...fmt, data };
}

function buildPcmWav(info: Omit<WavInfo, "data">, data: Buffer): Buffer {
  const byteRate = info.sampleRate * info.channels * (info.bitsPerSample / 8);
  const blockAlign = info.channels * (info.bitsPerSample / 8);
  const out = Buffer.alloc(44 + data.length);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + data.length, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(info.audioFormat, 20);
  out.writeUInt16LE(info.channels, 22);
  out.writeUInt32LE(info.sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(info.bitsPerSample, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(data.length, 40);
  data.copy(out, 44);
  return out;
}

async function concatPcmWavs(inputPaths: string[], destPath: string): Promise<void> {
  if (inputPaths.length === 0) {
    throw new Error("concatPcmWavs requires at least one input");
  }

  const wavs = await Promise.all(
    inputPaths.map(async (filepath) =>
      readPcmWav(await fs.readFile(filepath), filepath),
    ),
  );
  const first = wavs[0]!;
  for (let i = 1; i < wavs.length; i++) {
    const w = wavs[i]!;
    if (
      w.audioFormat !== first.audioFormat ||
      w.channels !== first.channels ||
      w.sampleRate !== first.sampleRate ||
      w.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error(`wav format mismatch while concatenating scene audio: ${inputPaths[i]}`);
    }
  }

  const data = Buffer.concat(wavs.map((w) => w.data));
  await fs.writeFile(destPath, buildPcmWav(first, data));
}

/**
 * Plan JSON を読み、scene 単位 TTS 生成 + plan の時刻更新を一気通貫で実行。
 */
export async function generatePlanTts(
  planId: string,
  opts: GeneratePlanTtsOptions = {},
): Promise<GeneratePlanTtsResult> {
  const channelSlug = opts.channelSlug ?? "manabilab";
  const log = opts.onProgress ?? (() => {});

  // 1. Load plan
  const planPath = path.join(
    REPO_ROOT,
    "packages",
    "channels",
    channelSlug,
    "plans",
    `${planId}.json`,
  );
  log(`📄 plan を読み込み: ${planPath}`);
  const planRaw = await fs.readFile(planPath, "utf-8");
  const plan = JSON.parse(planRaw) as ManabilabPlan;

  // 2. Concat scene narrations for character accounting / optional fallback only.
  const fullText = plan.scenes.map((s) => s.narration).join("");
  const characters = charLen(fullText);
  log(`📝 ${plan.scenes.length} シーン / 合計 ${characters} 文字`);

  if (plan.audio.voiceProvider !== "voicevox") {
    throw new Error(
      `manabilab-tts は voicevox provider のみサポート。plan.audio.voiceProvider="${plan.audio.voiceProvider}"`,
    );
  }

  // 3. VOICEVOX で scene ごとの wav を生成
  const audioRelPath = plan.audio.path;
  const audioAbsPath = path.isAbsolute(audioRelPath)
    ? audioRelPath
    : path.join(REPO_ROOT, audioRelPath);
  await fs.mkdir(path.dirname(audioAbsPath), { recursive: true });

  const readingsMap: Record<string, string> = {};
  for (const r of plan.readings ?? []) {
    readingsMap[r.term] = r.reading;
  }

  const tmpDir = `${audioAbsPath}.segments-${Date.now()}`;
  await fs.mkdir(tmpDir, { recursive: true });

  const sceneTimingsRaw: Array<{ index: number; startSec: number; endSec: number }> = [];
  const segmentPaths: string[] = [];
  let cursor = 0;
  let ttsCharacters = 0;
  try {
    log(
      `🎤 VOICEVOX TTS をシーン単位で実行 (speaker=${plan.audio.voiceId ?? 13}, speed=${plan.audio.speedScale ?? 1.0}, intonation=${plan.audio.intonationScale ?? 1.0})...`,
    );
    for (const scene of plan.scenes) {
      const segmentPath = path.join(
        tmpDir,
        `scene-${String(scene.index).padStart(2, "0")}.wav`,
      );
      const tts = await synthesizeNarrationVoicevox(scene.narration, segmentPath, {
        speakerId: plan.audio.voiceId,
        speedScale: plan.audio.speedScale,
        intonationScale: plan.audio.intonationScale,
        readings: readingsMap,
        baseUrl: opts.voicevoxBaseUrl,
      });
      segmentPaths.push(segmentPath);
      ttsCharacters += tts.characters;
      const startSec = cursor;
      const endSec = cursor + tts.approxDurationSec;
      sceneTimingsRaw.push({ index: scene.index, startSec, endSec });
      cursor = endSec;
      log(
        `  ✓ scene ${scene.index}: ${tts.characters} 文字 / ${tts.approxDurationSec.toFixed(2)}秒`,
      );
    }

    await concatPcmWavs(segmentPaths, audioAbsPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  const totalDurationSec = cursor;
  log(`  ✓ 連結 wav を生成: ${totalDurationSec.toFixed(2)}秒`);

  // 4. Optional dry-run mode keeps historical API behavior: return timings only.
  if (opts.skipAlignment) {
    log("⏭️ skipAlignment=true のため plan 保存をスキップ");
    return {
      audioPath: audioRelPath,
      audioAbsPath,
      totalDurationSec,
      characters: ttsCharacters,
      scenes: sceneTimingsRaw.map((t) => ({
        index: t.index,
        startSec: t.startSec,
        endSec: t.endSec,
        durationSec: t.endSec - t.startSec,
      })),
      brokenByGuard: false,
      qualityReasons: ["scene-segmented-tts", "skipped-plan-save"],
    };
  }

  // 5. Plan 上書き保存
  for (const scene of plan.scenes) {
    const t = sceneTimingsRaw.find((x) => x.index === scene.index);
    if (!t) continue;
    scene.startSec = Number(t.startSec.toFixed(3));
    scene.endSec = Number(t.endSec.toFixed(3));
  }
  plan.totalDurationSec = Number(totalDurationSec.toFixed(3));
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
  log(`💾 plan を更新: totalDurationSec=${plan.totalDurationSec}`);

  return {
    audioPath: audioRelPath,
    audioAbsPath,
    totalDurationSec,
    characters: ttsCharacters,
    scenes: sceneTimingsRaw.map((t) => ({
      index: t.index,
      startSec: Number(t.startSec.toFixed(3)),
      endSec: Number(t.endSec.toFixed(3)),
      durationSec: Number((t.endSec - t.startSec).toFixed(3)),
    })),
    brokenByGuard: false,
    qualityReasons: ["scene-segmented-tts"],
  };
}
