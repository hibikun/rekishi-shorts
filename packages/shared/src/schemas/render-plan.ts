import { z } from "zod";
import { SceneSchema, ScriptSchema } from "./script";
import {
  AudioAssetSchema,
  CaptionSegmentSchema,
  CaptionWordSchema,
  ImageAssetSchema,
} from "./asset";

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;
/** ukiyoe チャンネル用。Seedance 1.5 Pro が 24fps で吐くので Composition も揃える。
 *  30fps composition で 24fps ソースを再生すると 6 frame 周期でジャダーが出る。 */
export const UKIYOE_VIDEO_FPS = 24;

export const RenderPlanSchema = z.object({
  id: z.string().describe("ジョブID (uuid or timestamp)"),
  script: ScriptSchema,
  scenes: z.array(SceneSchema),
  images: z.array(ImageAssetSchema),
  audio: AudioAssetSchema,
  // Whisper 由来の word 単位タイムスタンプ（scene aligner / KeywordPopup 用途）
  captions: z.array(CaptionWordSchema),
  // scene 単位の phrase 字幕（Caption 表示用途）
  captionSegments: z.array(CaptionSegmentSchema).default([]),
  totalDurationSec: z.number().positive(),
  createdAt: z.string().describe("ISO 8601"),
});
export type RenderPlan = z.infer<typeof RenderPlanSchema>;
