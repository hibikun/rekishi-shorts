import { z } from "zod";
import { TopicSchema, VideoTitleSchema } from "./script.js";

export const CanvaStatementSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe(
      "セグメントの見出し（5〜18字）。シーン上で大きく出す前提の短いラベル。例: '1. ダークチョコ' / '寝る前に5分'",
    ),
  claim: z
    .string()
    .min(1)
    .describe("そのセグメントの主張本体。1〜2文で歯切れ良く言い切る"),
  backupLogic: z
    .string()
    .min(1)
    .describe(
      "裏付け。1〜3文でメカニズム + 数字 + 出典を1セットで提示。リサーチ資料の数字・研究者名を引く",
    ),
});
export type CanvaStatement = z.infer<typeof CanvaStatementSchema>;

export const CanvaReadingSchema = z.object({
  term: z.string().min(1),
  reading: z.string().min(1),
});
export type CanvaReading = z.infer<typeof CanvaReadingSchema>;

export const ManabilabCanvaScriptSchema = z.object({
  topic: TopicSchema,
  hook: z
    .string()
    .min(1)
    .describe(
      "掴みの 1〜2 文（20-50字）。型に縛られず、視聴者がツッコミたくなる軽さで",
    ),
  statements: z
    .array(CanvaStatementSchema)
    .min(2)
    .max(7)
    .describe(
      "主張群。トピックが N 選なら必ず N 個、単一テーマなら 2〜5 個",
    ),
  cta: z
    .string()
    .min(1)
    .describe(
      "行動を促す 1 文（15-35字）。「明日○○だけ試して」のような小さな一歩",
    ),
  punchline: z
    .string()
    .min(1)
    .describe(
      "ツッコミどころ満載のフレーズで締める（10-30字）。期間×情景の決め台詞は禁止",
    ),
  title: VideoTitleSchema,
  readings: z
    .array(CanvaReadingSchema)
    .default([])
    .describe(
      "英字研究者名や難読語の読みリスト。0〜2 個が普通",
    ),
  estimatedDurationSec: z
    .number()
    .positive()
    .describe("ナレーション全体の読み上げ秒数の見積もり（35-50秒目安）"),
});
export type ManabilabCanvaScript = z.infer<typeof ManabilabCanvaScriptSchema>;
