import { z } from "zod";
import { VideoTitleSchema } from "./script";
import { SelfMotivationTopicSchema } from "./self-motivation-topic";

export const SelfMotivationChapterSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("章タイトル。8〜20字。例: 'まず朝5時に起きる'"),
  narrationParagraphs: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "この章で読み上げる段落の配列。章ロールに応じて構造が違う: 第1章 Myth-Busting (Declaration & Distill) は 4 or 6 段落、第2章以降 Method-Teaching (DPMK + 敷居下げ + キラーライン×2) は 5 or 6 段落、最終章 Closing Philosophy は 3 or 4 段落。詳細は channels/self-motivation/prompts/script.md の『章設計（厳守）』参照。後段で句読点+budoux で 2-3 フレーズ単位の Scene に展開される",
    ),
});
export type SelfMotivationChapter = z.infer<typeof SelfMotivationChapterSchema>;

export const SelfMotivationReadingSchema = z.object({
  term: z.string().min(1),
  reading: z.string().min(1),
});
export type SelfMotivationReading = z.infer<typeof SelfMotivationReadingSchema>;

export const SelfMotivationScriptSchema = z.object({
  topic: SelfMotivationTopicSchema,
  openingTitle: VideoTitleSchema.describe(
    "動画冒頭のタイトルカード（top 小・bottom 大の2行）",
  ),
  openingHook: z
    .string()
    .min(1)
    .describe(
      "冒頭フック。PAS フレームワーク拡張型 7 ステップ (痛み列挙 → 根本原因の断定 → 将来への警告 → 内なる声の代弁 → 免責と犯人交代 → 二者択一 → 動画の約束) を順序通りに繋いだ 250〜350 字。詳細は channels/self-motivation/prompts/script.md の『冒頭フック構造』参照",
    ),
  chapters: z
    .array(SelfMotivationChapterSchema)
    .min(1)
    .max(12)
    .describe(
      "章の配列。10分動画想定で 5〜8 章が標準。各章は 1〜2 分尺",
    ),
  closingCta: z
    .string()
    .min(1)
    .describe(
      "締めの行動喚起 1〜2 文（30〜120字）。「明日からまず○○を試して」のような小さな一歩",
    ),
  readings: z
    .array(SelfMotivationReadingSchema)
    .default([])
    .describe("難読語の読みリスト。固有名詞や英字研究者名がある場合に使う"),
  estimatedDurationSec: z
    .number()
    .positive()
    .describe("ナレーション全体の読み上げ秒数の見積もり（300-600秒目安）"),
});
export type SelfMotivationScript = z.infer<typeof SelfMotivationScriptSchema>;
