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
 * 生成した音声ファイル（mp3）を Whisper に送り、単語タイムスタンプを取得する。
 * 戻り値の最後の endSec を音声の全体秒数として使える。
 */
export async function alignCaptions(audioPath: string): Promise<{
  words: CaptionWord[];
  totalDurationSec: number;
}> {
  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const buffer = fs.readFileSync(audioPath);
  const file = new File([buffer], "narration.mp3", { type: "audio/mpeg" });

  const transcription = (await openai.audio.transcriptions.create({
    file: file as unknown as Parameters<typeof openai.audio.transcriptions.create>[0]["file"],
    model: config.openai.whisperModel,
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
    language: "ja",
  })) as unknown as { words?: WhisperWord[]; duration?: number };

  const rawWords = transcription.words ?? [];
  const words: CaptionWord[] = rawWords.map((w) =>
    CaptionWordSchema.parse({
      text: w.word,
      startSec: w.start,
      endSec: w.end,
    }),
  );

  const totalDurationSec = transcription.duration ?? (words.at(-1)?.endSec ?? 0);
  return { words, totalDurationSec };
}
