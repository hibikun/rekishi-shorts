import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { config } from "./config.js";

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
    "Say the following in natural, clear Japanese with a confident educational narrator's voice, slightly fast pace (suitable for a YouTube Shorts video):",
  reviewer:
    "Read the following Japanese text as a casual short user review comment for a YouTube Shorts video. Sound conversational and personal, not like an announcer. Keep it natural and brief:",
};

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
  const voiceName = opts.voiceName ?? process.env.GEMINI_TTS_VOICE ?? "Kore";
  const model = process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";
  const persona: VoicePersona = opts.persona ?? "narrator";

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const styledPrompt = `${STYLE_PROMPTS[persona]}\n${processed}`;

  const response = await ai.models.generateContent({
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
  });

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
