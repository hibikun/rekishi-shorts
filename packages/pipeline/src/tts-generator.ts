import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { getChannel } from "@rekishi/shared/channel";
import { config } from "./config.js";

// チャンネル別の narrator default。
// - ranking: "大人でリッチ" 基調で Zubenelgenubi
// - manabilab: 低音・権威感のある男性ボイス Charon (informative, deep)。
//   合わなければ Fenrir (dramatic, deep) / Orus (firm) を試す。
// - rekishi/kosei: 明示エントリを置かず、従来通り GEMINI_TTS_VOICE / "Kore" にフォールバック。
const NARRATOR_VOICE_BY_CHANNEL: Record<string, string> = {
  ranking: "Zubenelgenubi",
  manabilab: "Zubenelgenubi",
};

/**
 * 現在のチャンネルに応じて narrator voice を決める。優先順:
 *   1. 明示オーバーライド (cli の引数や呼び出し側 opts)
 *   2. GEMINI_TTS_VOICE_<CHANNEL> env (例: GEMINI_TTS_VOICE_RANKING)
 *   3. NARRATOR_VOICE_BY_CHANNEL の組み込み default
 *   4. GEMINI_TTS_VOICE 互換 env (旧グローバル設定)
 *   5. 最終フォールバック "Kore"
 *
 * 3 を 4 より先に置いてあるため、ユーザーが旧来の GEMINI_TTS_VOICE=Kore を残していても
 * ranking だけ別声で再生される（rekishi/kosei は表に未登録なので 4 が拾う）。
 */
export function resolveNarratorVoice(override?: string): string {
  const channel = getChannel();
  const channelKey = channel.toUpperCase();
  return (
    override ??
    process.env[`GEMINI_TTS_VOICE_${channelKey}`] ??
    NARRATOR_VOICE_BY_CHANNEL[channel] ??
    process.env.GEMINI_TTS_VOICE ??
    "Kore"
  );
}

export interface TTSResult {
  path: string;
  /** loudnorm 後の真の wav 長 (ffprobe 実測, 取得失敗時は PCM 長フォールバック) */
  approxDurationSec: number;
  /** 課金文字数 (furigana置換後) */
  characters: number;
  /** usageMetadata (Gemini返却分、コスト算出用) */
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
}

const SAMPLE_RATE = 24000;
// loudnorm で -14 LUFS (YouTube 標準) に揃えた後、+4dB のメイクアップゲインと
// alimiter でショート向けに「攻めた」音圧 (~-10 dB mean) まで押し上げる。
// Remotion → AAC エンコード時に約 -3dB 落ちる傾向があるため、この程度を目安にする。
const LOUDNESS_FILTER =
  "loudnorm=I=-14:TP=-1:LRA=7,volume=4dB,alimiter=limit=0.95:attack=5:release=50";

/**
 * voicePersona ごとの Gemini TTS スタイル指示。Gemini TTS は prompt でトーン/間/語勢を
 * 引き出せるが、narrator 風 prompt をレビュー音声にも流用すると「アナウンサー調のレビュー」に
 * なってしまうため、reviewer は会話的・短評的な指示に切り替える。
 */
export type VoicePersona = "narrator" | "reviewer";

const STYLE_PROMPTS: Record<VoicePersona, string> = {
  narrator:
    "Say the following in natural, clear Japanese with a confident narrator's voice. Speak at a noticeably fast, brisk tempo — the punchy pace of a fast-cut YouTube Shorts video. Keep articulation crisp and minimize pauses between phrases. Stay natural; do not sound rushed or robotic:",
  reviewer:
    "Read the following Japanese text as a casual user review comment for a YouTube Shorts video. Deliver it extremely rapid-fire — machine-gun pace, like an excited friend texting reactions in a group chat. Leave zero pause between words, phrases, and sentences. Sound personal and natural, not announcer-like, but keep the tempo aggressively tight — get through the entire line in a single breath. Do not add reflective pauses or trailing fade-outs:",
};

// チャンネル別の style prompt 上書き (persona=narrator のみ)。
// 学習科学チャンネルは「権威ある先生が落ち着いて教える」テンポにしたい。
const NARRATOR_STYLE_BY_CHANNEL: Record<string, string> = {
  manabilab:
    "Say the following in natural Japanese with a deep, authoritative narrator's voice — like a trusted mentor revealing important scientific truths. Speak at a confident, brisk pace fit for fast-cut YouTube Shorts — energetic but clear, never blurred. Use CLEAR INFLECTION and put noticeable EMPHASIS on key words (numbers like 「2倍以上」「100年以上前」, scientific terms like 「想起練習」「分散学習」「Karpicke」, and key conclusions). Move smoothly between sentences without long pauses. Convey intellectual confidence and gravitas — NOT monotone, NOT slow:",
};

function resolveNarratorStylePrompt(persona: VoicePersona, override?: string): string {
  if (override) return override;
  if (persona === "narrator") {
    const channelOverride = NARRATOR_STYLE_BY_CHANNEL[getChannel()];
    if (channelOverride) return channelOverride;
  }
  return STYLE_PROMPTS[persona];
}

/**
 * Gemini 3.1 Flash TTS で日本語ナレーションを合成し、WAV として保存する。
 * approxDurationSec は loudnorm 適用後に ffprobe で再計測した真の wav 長。
 */
export async function synthesizeNarration(
  text: string,
  destPath: string,
  opts: {
    /** 台本由来の難読語読みマップ（優先適用） */
    readings?: Record<string, string>;
    /** 固定辞書由来のふりがなマップ */
    furigana?: Record<string, string>;
    voiceName?: string;
    /** 冒頭フック文。Kore 方針では未使用（将来 Algenib 的なdocumentary調に戻す際用） */
    hook?: string;
    /** スタイル指示の切り替え。レビュー読み上げは "reviewer" を渡す */
    persona?: VoicePersona;
  } = {},
): Promise<TTSResult> {
  const withReadings = applyFurigana(text, opts.readings);
  const processed = applyFurigana(withReadings, opts.furigana);
  const voiceName = resolveNarratorVoice(opts.voiceName);
  const model = process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";
  const persona: VoicePersona = opts.persona ?? "narrator";

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const styledPrompt = `${resolveNarratorStylePrompt(persona)}\n${processed}`;

  // Gemini TTS preview は per-minute レート制限 (現状 10 req/min) があるため、
  // 429 が返ったら retryDelay を尊重しつつ最大 6 回まで指数バックオフでリトライする。
  const response = await retryOn429(() =>
    ai.models.generateContent({
      model,
      contents: styledPrompt,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    }),
  );

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const audioPart = parts.find((p) => (p as { inlineData?: unknown }).inlineData !== undefined);
  const inlineData = audioPart
    ? (audioPart as { inlineData?: { data?: string; mimeType?: string } }).inlineData
    : undefined;
  if (!inlineData?.data) {
    throw new Error(`Gemini TTS returned no audio: ${JSON.stringify(response).slice(0, 500)}`);
  }

  const pcm = Buffer.from(inlineData.data, "base64");
  const wav = wrapPcmAsWav(pcm, SAMPLE_RATE, 1, 16);

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, wav);
  await loudnormInPlace(destPath);

  // loudnorm/alimiter は出力サンプル数を変える可能性があるため、ffprobe で実測する。
  // 失敗した場合は PCM 長へフォールバック（Remotion 側で多少のズレは許容）。
  const pcmDurationSec = pcm.length / (SAMPLE_RATE * 2); // 16-bit mono
  const durationSec = (await probeDurationSec(destPath)) ?? pcmDurationSec;

  return {
    path: destPath,
    approxDurationSec: durationSec,
    characters: processed.length,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model,
    },
  };
}

/**
 * ElevenLabs TTS で日本語ナレーションを合成し、loudnorm 適用後の WAV として保存する。
 * Gemini TTS の synthesizeNarration と同じ TTSResult を返すので呼び出し側は差し替え可能。
 *
 * 声は voiceId 引数で明示指定する（ENV ELEVENLABS_VOICE_ID は default として使う）。
 * voice_settings は ElevenLabs の standard（stability=0.5, similarity_boost=0.75）。
 * 必要なら opts.voiceSettings で上書き可。
 */
export async function synthesizeNarrationElevenLabs(
  text: string,
  destPath: string,
  opts: {
    voiceId?: string;
    modelId?: string;
    readings?: Record<string, string>;
    furigana?: Record<string, string>;
    voiceSettings?: {
      stability?: number;
      similarityBoost?: number;
      style?: number;
      useSpeakerBoost?: boolean;
    };
  } = {},
): Promise<TTSResult> {
  const withReadings = applyFurigana(text, opts.readings);
  const processed = applyFurigana(withReadings, opts.furigana);
  const voiceId = opts.voiceId ?? config.elevenlabs.voiceId;
  const modelId = opts.modelId ?? config.elevenlabs.model;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const body = {
    text: processed,
    model_id: modelId,
    voice_settings: {
      stability: opts.voiceSettings?.stability ?? 0.5,
      similarity_boost: opts.voiceSettings?.similarityBoost ?? 0.75,
      style: opts.voiceSettings?.style ?? 0,
      use_speaker_boost: opts.voiceSettings?.useSpeakerBoost ?? true,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenlabs.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs TTS ${response.status}: ${errText.slice(0, 500)}`);
  }
  const mp3Buffer = Buffer.from(await response.arrayBuffer());

  // mp3 → loudnorm 適用済み wav に変換 (ffmpeg 1pass で完結)
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const tmpMp3 = `${destPath}.tmp.mp3`;
  await fs.writeFile(tmpMp3, mp3Buffer);
  try {
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      tmpMp3,
      "-af",
      LOUDNESS_FILTER,
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      destPath,
    ]);
  } finally {
    try {
      await fs.unlink(tmpMp3);
    } catch {
      /* noop */
    }
  }

  const durationSec = (await probeDurationSec(destPath)) ?? 0;

  return {
    path: destPath,
    approxDurationSec: durationSec,
    characters: processed.length,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      model: `elevenlabs:${modelId}:${voiceId}`,
    },
  };
}

/**
 * VOICEVOX engine (ローカル HTTP API, 既定 http://127.0.0.1:50021) で日本語ナレーションを合成。
 * Gemini TTS / ElevenLabs と同じ TTSResult を返すので呼び出し側は差し替え可能。
 *
 * 事前準備: VOICEVOX app (https://voicevox.hiroshiba.jp/) を起動するか、
 *   docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest
 *
 * speaker ID 例（青山龍星 系）:
 *   13: ノーマル / 81: 熱血 / 82: 不機嫌 / 83: 喜び / 84: しっとり / 85: かなしみ / 86: 囁き
 */
export async function synthesizeNarrationVoicevox(
  text: string,
  destPath: string,
  opts: {
    speakerId?: number;
    baseUrl?: string;
    readings?: Record<string, string>;
    furigana?: Record<string, string>;
    /** デフォルト 1.0。0.9 でゆっくり、1.1 で速く */
    speedScale?: number;
    /** デフォルト 0。-0.05 で少し低音化 */
    pitchScale?: number;
    /** デフォルト 1.0。1.2 で抑揚 +20% (Bro Pump 風の "強調" を出すなら 1.2-1.4 推奨) */
    intonationScale?: number;
    /** デフォルト 1.0 */
    volumeScale?: number;
  } = {},
): Promise<TTSResult> {
  const withReadings = applyFurigana(text, opts.readings);
  const processed = applyFurigana(withReadings, opts.furigana);
  const speakerId = opts.speakerId ?? 13; // 青山龍星 ノーマル
  const baseUrl = opts.baseUrl ?? "http://127.0.0.1:50021";

  // 1) audio_query で query JSON を作る
  const queryUrl = `${baseUrl}/audio_query?speaker=${speakerId}&text=${encodeURIComponent(processed)}`;
  let queryResp: Response;
  try {
    queryResp = await fetch(queryUrl, { method: "POST" });
  } catch (err) {
    throw new Error(
      `VOICEVOX engine に接続できません (${baseUrl})。VOICEVOX app を起動してください、または docker で voicevox/voicevox_engine を立ち上げてください。詳細: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (!queryResp.ok) {
    throw new Error(
      `VOICEVOX audio_query ${queryResp.status}: ${(await queryResp.text()).slice(0, 200)}`,
    );
  }
  const query = (await queryResp.json()) as Record<string, unknown>;

  // パラメータ上書き
  if (opts.speedScale !== undefined) query.speedScale = opts.speedScale;
  if (opts.pitchScale !== undefined) query.pitchScale = opts.pitchScale;
  if (opts.intonationScale !== undefined) query.intonationScale = opts.intonationScale;
  if (opts.volumeScale !== undefined) query.volumeScale = opts.volumeScale;

  // 2) synthesis で wav を生成
  const synthResp = await fetch(`${baseUrl}/synthesis?speaker=${speakerId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!synthResp.ok) {
    throw new Error(
      `VOICEVOX synthesis ${synthResp.status}: ${(await synthResp.text()).slice(0, 200)}`,
    );
  }
  const wavBuffer = Buffer.from(await synthResp.arrayBuffer());

  // VOICEVOX 出力 wav → ffmpeg loudnorm 適用 → 24kHz mono wav
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const tmpWav = `${destPath}.tmp.wav`;
  await fs.writeFile(tmpWav, wavBuffer);
  try {
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      tmpWav,
      "-af",
      LOUDNESS_FILTER,
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      destPath,
    ]);
  } finally {
    try {
      await fs.unlink(tmpWav);
    } catch {
      /* noop */
    }
  }

  const durationSec = (await probeDurationSec(destPath)) ?? 0;

  return {
    path: destPath,
    approxDurationSec: durationSec,
    characters: processed.length,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      model: `voicevox:speaker-${speakerId}`,
    },
  };
}

/**
 * ffprobe で wav の真の秒数を取得。失敗時は null を返し、呼び出し側はフォールバックすること。
 */
export async function probeDurationSec(filePath: string): Promise<number | null> {
  try {
    const stdout = await runFfprobeStdout([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const v = Number(stdout.trim());
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Gemini API の 429 (RESOURCE_EXHAUSTED) を捕まえて retryDelay 秒待ってリトライする。
 * retryDelay が読めない場合は指数バックオフ (2^attempt 秒)。最大 6 回まで。
 */
async function retryOn429<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
      if (!is429 || attempt === maxAttempts - 1) throw err;
      const retryAfterSec = parseRetryAfterSec(msg) ?? Math.min(60, 2 ** (attempt + 2));
      // eslint-disable-next-line no-console
      console.warn(
        `[tts-generator] 429 hit (attempt ${attempt + 1}/${maxAttempts}), waiting ${retryAfterSec.toFixed(1)}s...`,
      );
      await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
    }
  }
  throw new Error("retryOn429: unreachable");
}

function parseRetryAfterSec(msg: string): number | null {
  const m = msg.match(/Please retry in ([\d.]+)s/);
  if (m) return Number(m[1]);
  const m2 = msg.match(/retryDelay"?\s*[:=]\s*"?(\d+)s/i);
  if (m2) return Number(m2[1]);
  return null;
}

function runFfprobeStdout(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exited ${code}: ${stderr}`));
    });
  });
}

function applyFurigana(text: string, map?: Record<string, string>): string {
  if (!map) return text;
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

async function loudnormInPlace(wavPath: string): Promise<void> {
  const tmpPath = `${wavPath}.norm.wav`;
  await runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    wavPath,
    "-af",
    LOUDNESS_FILTER,
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    tmpPath,
  ]);
  await fs.rename(tmpPath, wavPath);
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

function wrapPcmAsWav(pcm: Buffer, sampleRate: number, channels: number, bits: number): Buffer {
  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
