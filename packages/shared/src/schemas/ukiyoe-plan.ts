import { z } from "zod";
import { CaptionSegmentSchema, CaptionWordSchema } from "./asset";
import { MotionGrammarSchema } from "./motion";

export const UkiyoeActionTagSchema = z.enum([
  "running_forward",
  "eating_meal",
  "drawing_sword",
  "walking_carrying",
  "sleeping",
  "crowd_cheering",
  "weather_dynamic",
  "still_subtle",
]);
export type UkiyoeActionTag = z.infer<typeof UkiyoeActionTagSchema>;

export const UkiyoeSceneSchema = z.object({
  index: z.number().int().nonnegative(),
  narration: z.string(),
  durationSec: z.number().positive(),
  /** 静止画パス（image-gen の出力）。 file:// 絶対パス */
  imagePath: z.string(),
  /** Seedance で生成した動画クリップのパス。 file:// 絶対パス */
  videoPath: z.string(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
  /**
   * 日本語版の videoPrompt（編集用）。Web UI で人間が編集する一次入力。
   * 翻訳ボタン押下時に Gemini で英訳されて videoPrompt にコピーされる。
   * 既存 plan で未設定の場合は undefined。
   */
  videoPromptJa: z.string().optional(),
  actionTag: UkiyoeActionTagSchema,
  cameraFixed: z.boolean().optional(),
  motion: MotionGrammarSchema.optional(),
});
export type UkiyoeScene = z.infer<typeof UkiyoeSceneSchema>;

export const UkiyoePlanSchema = z.object({
  id: z.string().describe("ジョブID"),
  topic: z.string(),
  era: z.string().nullable().optional(),
  hook: z.string(),
  /** ナレーション全文（rekishi の Script.narration と同等） */
  narration: z.string(),
  keyTerms: z.array(z.string()).default([]),
  readings: z.record(z.string(), z.string()).default({}),
  scenes: z.array(UkiyoeSceneSchema),
  /** narration.wav の絶対パス */
  audioPath: z.string(),
  /** word 単位タイムスタンプ（Whisper 由来） */
  captions: z.array(CaptionWordSchema).default([]),
  /** phrase 単位字幕（Caption 表示用途） */
  captionSegments: z.array(CaptionSegmentSchema).default([]),
  totalDurationSec: z.number().positive(),
  createdAt: z.string().describe("ISO 8601"),
});
export type UkiyoePlan = z.infer<typeof UkiyoePlanSchema>;
