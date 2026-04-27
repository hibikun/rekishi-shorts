import { z } from "zod";
import { CaptionSegmentSchema, CaptionWordSchema } from "./asset";
import { VideoTitleSchema } from "./script";

export const KOSEI_ANIMATION_VIDEO_FPS = 24;

export const KoseiAnimationMotionTagSchema = z.enum([
  "breathing_idle",
  "subtle_head_turn",
  "slow_walk",
  "mouth_open_close",
  "feeding_motion",
  "tail_body_motion",
  "environment_motion",
  "fossil_camera_push",
  "detail_camera_push",
  "still_subtle",
]);
export type KoseiAnimationMotionTag = z.infer<typeof KoseiAnimationMotionTagSchema>;

export const KoseiAnimationSceneSchema = z.object({
  index: z.number().int().nonnegative(),
  narration: z.string(),
  durationSec: z.number().positive(),
  visualIntent: z.string(),
  imagePath: z.string(),
  videoPath: z.string(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
  motionTag: KoseiAnimationMotionTagSchema,
  cameraFixed: z.boolean().optional(),
});
export type KoseiAnimationScene = z.infer<typeof KoseiAnimationSceneSchema>;

export const KoseiAnimationPlanSchema = z.object({
  id: z.string(),
  topic: z.string(),
  era: z.string().nullable().optional(),
  hook: z.string(),
  title: VideoTitleSchema,
  narration: z.string(),
  keyTerms: z.array(z.string()).default([]),
  readings: z.record(z.string()).default({}),
  scenes: z.array(KoseiAnimationSceneSchema),
  audioPath: z.string(),
  captions: z.array(CaptionWordSchema).default([]),
  captionSegments: z.array(CaptionSegmentSchema).default([]),
  totalDurationSec: z.number().positive(),
  createdAt: z.string(),
});
export type KoseiAnimationPlan = z.infer<typeof KoseiAnimationPlanSchema>;
