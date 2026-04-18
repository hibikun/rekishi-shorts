import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { config } from "./config.js";

export interface TTSResult {
  path: string;
  /** 実測の秒数 (PCMサンプル数から算出) */
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

/**
 * Gemini 3.1 Flash TTS で日本語ナレーションを合成し、WAV として保存する。
 * 返り値の durationSec はPCMサンプル数から正確に算出。
 */
export async function synthesizeNarration(
  text: string,
  destPath: string,
  opts: { furigana?: Record<string, string>; voiceName?: string } = {},
): Promise<TTSResult> {
  const processed = applyFurigana(text, opts.furigana);
  const voiceName = opts.voiceName ?? process.env.GEMINI_TTS_VOICE ?? "Kore";
  const model = process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  // ショート動画用の指示を prompt に含める (Gemini TTS は prompt でスタイル制御可能)
  const styledPrompt = `Say the following in natural, clear Japanese with a confident educational narrator's voice, slightly fast pace (suitable for a YouTube Shorts video for students):\n${processed}`;

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

  const durationSec = pcm.length / (SAMPLE_RATE * 2); // 16-bit mono

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

function applyFurigana(text: string, map?: Record<string, string>): string {
  if (!map) return text;
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
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
