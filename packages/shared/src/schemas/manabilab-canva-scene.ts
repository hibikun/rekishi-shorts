import { z } from "zod";

export const CanvaSceneSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hook") }),
  z.object({
    kind: z.literal("statement"),
    statementIndex: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("cta") }),
  z.object({ kind: z.literal("punchline") }),
]);
export type CanvaSceneSource = z.infer<typeof CanvaSceneSourceSchema>;

export const ManabilabCanvaSceneSchema = z.object({
  index: z.number().int().positive().describe("1始まりのシーン番号"),
  source: CanvaSceneSourceSchema.describe(
    "このシーンが台本のどのセグメントから来たか",
  ),
  narration: z
    .string()
    .min(1)
    .describe("TTS で読み上げるナレーション本文"),
  caption: z
    .string()
    .min(1)
    .describe("画面に大きく出す字幕（短文）。Canva 上のテキスト要素に流す前提"),
  imagePromptJa: z
    .string()
    .default("")
    .describe(
      "画像生成プロンプト（日本語・編集用）。後段の画像生成で英訳して使う",
    ),
  imagePromptEn: z
    .string()
    .default("")
    .describe(
      "画像生成プロンプト（英語・最終形）。Nano Banana など英語入力モデル用",
    ),
  imagePath: z
    .string()
    .optional()
    .describe(
      "生成済み画像の相対パス。例: 'jobs/{jobId}/images/scene-01.png' (channels/manabilab-canva 起点)",
    ),
  imageGeneratedAt: z
    .string()
    .optional()
    .describe("画像生成日時 (ISO 8601)"),
});
export type ManabilabCanvaScene = z.infer<typeof ManabilabCanvaSceneSchema>;

export const ManabilabCanvaScenesSchema = z.object({
  scenes: z.array(ManabilabCanvaSceneSchema).min(1),
});
export type ManabilabCanvaScenes = z.infer<typeof ManabilabCanvaScenesSchema>;
