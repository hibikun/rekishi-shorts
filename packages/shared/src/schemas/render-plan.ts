import { z } from "zod";
import { SceneSchema, ScriptSchema } from "./script";
import { AudioAssetSchema, CaptionWordSchema, ImageAssetSchema } from "./asset";

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;

export const RenderPlanSchema = z.object({
  id: z.string().describe("ジョブID (uuid or timestamp)"),
  script: ScriptSchema,
  scenes: z.array(SceneSchema),
  images: z.array(ImageAssetSchema),
  audio: AudioAssetSchema,
  captions: z.array(CaptionWordSchema),
  totalDurationSec: z.number().positive(),
  createdAt: z.string().describe("ISO 8601"),
});
export type RenderPlan = z.infer<typeof RenderPlanSchema>;
