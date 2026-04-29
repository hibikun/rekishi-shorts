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
      "この章で読み上げる段落の配列。1段落 = 1〜3 文（40〜120字）が目安。後段で句読点+budoux で 2-3 フレーズ単位の Scene に展開される",
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
    .describe("冒頭5〜10秒の掴み。視聴者を引き込む 1〜2 文（30〜80字）"),
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
