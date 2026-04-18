import fs from "node:fs";
import { File } from "node:buffer";
import OpenAI from "openai";
import { CaptionWordSchema, type CaptionWord } from "@rekishi/shared";
import { config } from "./config.js";

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

/**
 * 生成した音声ファイルを Whisper に送り、単語タイムスタンプを取得する。
 *
 * 改善点 (v2):
 * - `prompt: scriptText` で既知語彙バイアスをかけて転写精度を底上げ
 * - Whisperは小さなチャンク（数字・カナ）に分けがちなので、分割された数字を
 *   再結合する簡易マージ処理を入れる
 * - WAV/MP3 両対応
 */
export async function alignCaptions(
  audioPath: string,
  opts: { scriptText?: string } = {},
): Promise<{
  words: CaptionWord[];
  totalDurationSec: number;
}> {
  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const buffer = fs.readFileSync(audioPath);
  const ext = audioPath.endsWith(".wav") ? "wav" : "mp3";
  const mime = ext === "wav" ? "audio/wav" : "audio/mpeg";
  const file = new File([buffer], `narration.${ext}`, { type: mime });

  const transcription = (await openai.audio.transcriptions.create({
    file: file as unknown as Parameters<typeof openai.audio.transcriptions.create>[0]["file"],
    model: config.openai.whisperModel,
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
    language: "ja",
    // 台本を渡すことで固有名詞・年号・専門用語の転写精度が大幅に上がる
    prompt: opts.scriptText?.slice(0, 500),
  })) as unknown as { words?: WhisperWord[]; duration?: number };

  const rawWords = transcription.words ?? [];
  const merged = mergeDigitChunks(rawWords);
  const words: CaptionWord[] = merged.map((w) =>
    CaptionWordSchema.parse({
      text: w.word,
      startSec: w.start,
      endSec: w.end,
    }),
  );

  const totalDurationSec = transcription.duration ?? (words.at(-1)?.endSec ?? 0);
  return { words, totalDurationSec };
}

/**
 * Whisper は「1853年」を「18」「53」「年」に分割しがち。連続する数字を再結合。
 */
function mergeDigitChunks(words: WhisperWord[]): WhisperWord[] {
  if (words.length === 0) return words;
  const DIGITS = /^[0-9]+$/;
  const out: WhisperWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && DIGITS.test(prev.word) && DIGITS.test(w.word) && w.start - prev.end < 0.25) {
      prev.word = prev.word + w.word;
      prev.end = w.end;
      continue;
    }
    out.push({ ...w });
  }
  return out;
}
