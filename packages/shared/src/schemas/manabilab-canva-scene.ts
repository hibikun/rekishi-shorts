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

export const ImageCandidateSchema = z.object({
  variantIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("0/1/2 などのバリアント番号。ファイル名 scene-NN-vM.png に対応"),
  promptEn: z
    .string()
    .describe("Nano Banana に渡る英語プロンプト（このバリアント分）"),
  poseSummaryJa: z
    .string()
    .default("")
    .describe("UI に表示する日本語要約（30 字以内程度）"),
  imagePath: z
    .string()
    .optional()
    .describe(
      "生成済み画像の相対パス。例: 'jobs/{jobId}/images/scene-01-v0.png' (channels/manabilab-canva 起点)",
    ),
  generatedAt: z.string().optional().describe("画像生成日時 (ISO 8601)"),
});
export type ImageCandidate = z.infer<typeof ImageCandidateSchema>;

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
    .describe(
      "そのシーンの要点を 1 フレーズで（短文）。画像/動画 AI プロンプトの構図ヒント、および Images ステップの一覧でシーンを判別する目印に使う",
    ),
  imagePromptJa: z
    .string()
    .default("")
    .describe(
      "ユーザー指示（日本語・任意）。空なら caption / narration から推測。3 案すべての種として使う",
    ),
  imagePromptEn: z
    .string()
    .default("")
    .describe(
      "選択された候補の英語プロンプトのスナップショット（後段互換用）。imageCandidates[selectedCandidateIndex].promptEn のコピー",
    ),
  imageCandidates: z
    .array(ImageCandidateSchema)
    .default([])
    .describe(
      "1 シーンに対する画像候補（通常 3 件）。ユーザーが selectedCandidateIndex で 1 つ選ぶ",
    ),
  selectedCandidateIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "ユーザーが選んだ候補の variantIndex。選択時に imagePath / imagePromptEn / imageGeneratedAt を該当候補のもので上書きする",
    ),
  imagePath: z
    .string()
    .optional()
    .describe(
      "選択候補の画像相対パスのスナップショット。後段（Seedance / レンダリング）はこのフィールドだけを参照する",
    ),
  imageGeneratedAt: z
    .string()
    .optional()
    .describe("選択候補の画像生成日時 (ISO 8601)"),
  seedancePromptJa: z
    .string()
    .default("")
    .describe(
      "Seedance アニメーションのユーザー指示（日本語・任意）。例: 「血流が巡る」「マナビくんがチョコをかじる」",
    ),
  seedancePromptEn: z
    .string()
    .default("")
    .describe(
      "Seedance img2video に渡す英語プロンプト。Gemini で生成 or 手動編集",
    ),
  videoPath: z
    .string()
    .optional()
    .describe(
      "生成済み mp4 の相対パス。例: 'jobs/{jobId}/videos/scene-NN.mp4' (channels/manabilab-canva 起点)",
    ),
  videoGeneratedAt: z
    .string()
    .optional()
    .describe("動画生成日時 (ISO 8601)"),
  audioPath: z
    .string()
    .optional()
    .describe(
      "生成済み wav の相対パス。例: 'jobs/{jobId}/audio/scene-NN.wav' (channels/manabilab-canva 起点)",
    ),
  audioDurationSec: z
    .number()
    .optional()
    .describe("音声の実測秒数（ffprobe で取得）"),
  audioGeneratedAt: z
    .string()
    .optional()
    .describe("音声生成日時 (ISO 8601)"),
});
export type ManabilabCanvaScene = z.infer<typeof ManabilabCanvaSceneSchema>;

export const ManabilabCanvaScenesSchema = z.object({
  scenes: z.array(ManabilabCanvaSceneSchema).min(1),
});
export type ManabilabCanvaScenes = z.infer<typeof ManabilabCanvaScenesSchema>;
