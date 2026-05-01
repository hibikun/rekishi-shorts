import { z } from "zod";
import { UkiyoeScriptModeSchema } from "./ukiyoe-script";

export const UkiyoeStepStatusSchema = z.enum([
  "pending",
  "in-progress",
  "done",
  "error",
]);
export type UkiyoeStepStatus = z.infer<typeof UkiyoeStepStatusSchema>;

const StepBaseSchema = z.object({
  status: UkiyoeStepStatusSchema.default("pending"),
  updatedAt: z.string().optional(),
  error: z.string().optional(),
});

export const UkiyoeTopicSchema = z.object({
  title: z.string().min(1),
  person: z.string().nullable().optional(),
  era: z.string().nullable().optional(),
  mode: UkiyoeScriptModeSchema.default("life"),
  sceneCount: z.number().int().min(2).max(16).optional(),
  seriesKey: z.string().optional(),
  episodeIndex: z.number().int().nonnegative().optional(),
});
export type UkiyoeTopic = z.infer<typeof UkiyoeTopicSchema>;

export const UkiyoeYoutubeRefStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "error",
]);
export type UkiyoeYoutubeRefStatus = z.infer<
  typeof UkiyoeYoutubeRefStatusSchema
>;

export const UkiyoeYoutubeRefSchema = z.object({
  id: z.string(),
  url: z.string(),
  videoId: z.string(),
  title: z.string().optional(),
  note: z.string().optional(),
  status: UkiyoeYoutubeRefStatusSchema.default("pending"),
  transcriptPath: z.string().optional(),
  generatedAt: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  error: z.string().optional(),
  addedAt: z.string(),
  updatedAt: z.string().optional(),
});
export type UkiyoeYoutubeRef = z.infer<typeof UkiyoeYoutubeRefSchema>;

export const UkiyoeResearchStepSchema = StepBaseSchema.extend({
  sources: z
    .array(
      z.object({
        uri: z.string(),
        title: z.string().optional(),
        domain: z.string().optional(),
      }),
    )
    .default([]),
  queries: z.array(z.string()).default([]),
  model: z.string().optional(),
  youtubeRefs: z.array(UkiyoeYoutubeRefSchema).default([]),
});
export type UkiyoeResearchStepState = z.infer<typeof UkiyoeResearchStepSchema>;

export const UkiyoeScriptStepSchema = StepBaseSchema.extend({
  model: z.string().optional(),
  estimatedDurationSec: z.number().optional(),
});
export type UkiyoeScriptStepState = z.infer<typeof UkiyoeScriptStepSchema>;

export const UkiyoeImagesStepSchema = StepBaseSchema.extend({
  generatedScenes: z.array(z.number().int().nonnegative()).default([]),
});
export type UkiyoeImagesStepState = z.infer<typeof UkiyoeImagesStepSchema>;

export const UkiyoeTtsStepSchema = StepBaseSchema.extend({
  voiceProvider: z.literal("gemini").default("gemini"),
  voiceName: z.string().default("Charon"),
  ttsModel: z.string().optional(),
  characters: z.number().int().nonnegative().optional(),
  approxDurationSec: z.number().optional(),
});
export type UkiyoeTtsStepState = z.infer<typeof UkiyoeTtsStepSchema>;

export const UkiyoeVideosStepSchema = StepBaseSchema.extend({
  resolution: z.enum(["480p", "720p"]).optional(),
  generatedScenes: z.array(z.number().int().nonnegative()).default([]),
  totalEstimatedCostUsd: z.number().optional(),
  lastDryRun: z.boolean().optional(),
});
export type UkiyoeVideosStepState = z.infer<typeof UkiyoeVideosStepSchema>;

export const UkiyoeRenderStepSchema = StepBaseSchema.extend({
  outputPath: z.string().optional(),
  durationSec: z.number().optional(),
});
export type UkiyoeRenderStepState = z.infer<typeof UkiyoeRenderStepSchema>;

export const UkiyoeShipStepSchema = StepBaseSchema.extend({
  metaGenerated: z.boolean().optional(),
  youtubeVideoId: z.string().optional(),
  youtubeUrl: z.string().optional(),
  privacy: z.enum(["public", "unlisted", "private"]).optional(),
  publishedAt: z.string().optional(),
});
export type UkiyoeShipStepState = z.infer<typeof UkiyoeShipStepSchema>;

export const UkiyoeJobSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  topic: UkiyoeTopicSchema,
  steps: z.object({
    topic: StepBaseSchema,
    research: UkiyoeResearchStepSchema,
    script: UkiyoeScriptStepSchema,
    scenes: StepBaseSchema,
    images: UkiyoeImagesStepSchema,
    tts: UkiyoeTtsStepSchema,
    videos: UkiyoeVideosStepSchema,
    render: UkiyoeRenderStepSchema,
    ship: UkiyoeShipStepSchema,
  }),
});
export type UkiyoeJob = z.infer<typeof UkiyoeJobSchema>;

export const UKIYOE_STEP_ORDER = [
  "topic",
  "research",
  "script",
  "scenes",
  "images",
  "tts",
  "videos",
  "render",
  "ship",
] as const;
export type UkiyoeStepKey = (typeof UKIYOE_STEP_ORDER)[number];

export const UKIYOE_STEP_LABELS: Record<UkiyoeStepKey, string> = {
  topic: "Topic",
  research: "Research",
  script: "Script",
  scenes: "Scenes",
  images: "Images",
  tts: "TTS",
  videos: "Videos",
  render: "Render",
  ship: "Ship",
};
