import { z } from "zod";

/**
 * 長尺動画の 1 シーン。
 *
 * - sceneId: 永続不変の識別子（nanoid 8 桁等）。reorder しても保持される。
 *   物理ファイル名は sceneId ベース（images/{sceneId}.png, audio/{sceneId}.wav）で書き出す。
 * - index: 表示順序。MVP では生成時から不変だが、Phase 2 で reorder を入れる際に
 *   この値だけ更新する想定（sceneId と物理ファイルの紐付けは崩さない）。
 * - chapterIndex / paragraphIndex: 元の Script 章/段落番号。トレーサビリティ用途。
 */
export const SelfMotivationSceneSchema = z.object({
  sceneId: z
    .string()
    .min(1)
    .describe(
      "永続不変のシーン ID（nanoid 8 桁推奨）。物理ファイル名はこの ID を使う",
    ),
  index: z
    .number()
    .int()
    .nonnegative()
    .describe("表示順序（0 始まり）。reorder 時のみ更新"),
  chapterIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("元の Script.chapters のインデックス"),
  paragraphIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("元の章の narrationParagraphs のインデックス"),
  narration: z
    .string()
    .min(1)
    .describe("このシーンで読み上げるナレーション（40〜80字目安）"),
  imagePromptJa: z
    .string()
    .default("")
    .describe(
      "画像生成のための日本語ヒント（任意）。空なら narration から自動推測される",
    ),
  imagePromptEn: z
    .string()
    .default("")
    .describe("Nano Banana に渡る英語プロンプト。生成済みならスナップショット"),
  imagePath: z
    .string()
    .optional()
    .describe(
      "生成済み画像の相対パス。例: 'jobs/{jobId}/images/{sceneId}.png' (channels/self-motivation 起点)",
    ),
  imageGeneratedAt: z.string().optional().describe("画像生成日時 (ISO 8601)"),
  audioPath: z
    .string()
    .optional()
    .describe(
      "生成済み wav の相対パス。例: 'jobs/{jobId}/audio/{sceneId}.wav' (channels/self-motivation 起点)",
    ),
  audioDurationSec: z
    .number()
    .optional()
    .describe("ffprobe で取得した実測秒数。Composition の durationSec はこの値を使う"),
  audioGeneratedAt: z.string().optional().describe("音声生成日時 (ISO 8601)"),
  motionPresetId: z
    .string()
    .default("auto")
    .describe(
      "longform-motion-options の MOTION_PRESETS.id。デフォルトは 'auto'（Composition 側で index ベースに自動割当）",
    ),
  videoPath: z
    .string()
    .optional()
    .describe(
      "Seedance 等で生成したアニメ mp4 の相対パス。例: 'jobs/{jobId}/videos/{sceneId}.mp4' (channels/self-motivation 起点)。あれば Composition は静止画ではなく動画を再生する",
    ),
  videoDurationSec: z
    .number()
    .optional()
    .describe("Seedance が返した動画長（5 or 10s）。TTS が長ければ Loop で繰り返す"),
  videoGeneratedAt: z.string().optional().describe("動画生成日時 (ISO 8601)"),
  videoPromptJa: z
    .string()
    .default("")
    .describe("ユーザー編集可能な日本語アニメ指示（任意）"),
  videoPromptEn: z
    .string()
    .default("")
    .describe("Gemini が生成した英語 Seedance プロンプトのスナップショット"),
  videoResolution: z
    .enum(["480p", "720p"])
    .optional()
    .describe("生成解像度。default 720p"),
});
export type SelfMotivationScene = z.infer<typeof SelfMotivationSceneSchema>;

export const SelfMotivationScenesSchema = z.object({
  scenes: z.array(SelfMotivationSceneSchema).min(1),
});
export type SelfMotivationScenes = z.infer<typeof SelfMotivationScenesSchema>;
