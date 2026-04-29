import { z } from "zod";
import { TopicSchema } from "./script";

export const SelfMotivationStepStatusSchema = z.enum([
  "pending",
  "in-progress",
  "done",
  "error",
]);
export type SelfMotivationStepStatus = z.infer<
  typeof SelfMotivationStepStatusSchema
>;

const StepBaseSchema = z.object({
  status: SelfMotivationStepStatusSchema.default("pending"),
  updatedAt: z.string().optional(),
  error: z.string().optional(),
});

export const SelfMotivationResearchSourceSchema = z.object({
  uri: z.string(),
  title: z.string().optional(),
  domain: z.string().optional(),
});
export type SelfMotivationResearchSource = z.infer<
  typeof SelfMotivationResearchSourceSchema
>;

export const SelfMotivationResearchStepSchema = StepBaseSchema.extend({
  sources: z.array(SelfMotivationResearchSourceSchema).default([]),
  queries: z.array(z.string()).default([]),
  model: z.string().optional(),
});

export const SelfMotivationScriptStepSchema = StepBaseSchema.extend({
  model: z.string().optional(),
  estimatedDurationSec: z.number().optional(),
});

export const SelfMotivationTtsStepSchema = StepBaseSchema.extend({
  voiceProvider: z.literal("gemini").default("gemini"),
  voiceName: z
    .string()
    .default("Charon")
    .describe(
      "Gemini TTS の prebuilt voice 名。default は self-motivation チャンネル既定の Charon",
    ),
  ttsModel: z
    .string()
    .optional()
    .describe(
      "Gemini TTS モデル名。default は env GEMINI_TTS_MODEL or gemini-3.1-flash-tts-preview",
    ),
  concatAudioPath: z
    .string()
    .optional()
    .describe(
      "全シーン結合済み wav の相対パス。例: 'jobs/{jobId}/audio/full.wav' (channels/self-motivation 起点)",
    ),
  concatDurationSec: z.number().optional().describe("結合 wav の合計秒数"),
  concatGeneratedAt: z
    .string()
    .optional()
    .describe(
      "結合 wav の生成日時 (ISO 8601)。個別 audioGeneratedAt より古ければ再結合推奨",
    ),
});

export const SelfMotivationRenderStepSchema = StepBaseSchema.extend({
  outputPath: z
    .string()
    .optional()
    .describe(
      "完成 mp4 の相対パス。例: 'jobs/{jobId}/render/output.mp4' (channels/self-motivation 起点)",
    ),
  generatedAt: z.string().optional().describe("レンダ完了日時 (ISO 8601)"),
  durationSec: z.number().optional(),
  /** 実行中の進捗 (0..1)。バックグラウンド prosessor から更新される */
  progress: z.number().min(0).max(1).optional(),
});

export const SelfMotivationJobSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  topic: TopicSchema,
  steps: z.object({
    topic: StepBaseSchema,
    research: SelfMotivationResearchStepSchema,
    script: SelfMotivationScriptStepSchema,
    scenes: StepBaseSchema,
    images: StepBaseSchema,
    tts: SelfMotivationTtsStepSchema,
    render: SelfMotivationRenderStepSchema,
  }),
});
export type SelfMotivationJob = z.infer<typeof SelfMotivationJobSchema>;

export const SELF_MOTIVATION_STEP_ORDER = [
  "topic",
  "research",
  "script",
  "scenes",
  "images",
  "tts",
  "render",
] as const;
export type SelfMotivationStepKey =
  (typeof SELF_MOTIVATION_STEP_ORDER)[number];

export const SELF_MOTIVATION_STEP_LABELS: Record<
  SelfMotivationStepKey,
  string
> = {
  topic: "Topic",
  research: "Research",
  script: "Script",
  scenes: "Scenes",
  images: "Images",
  tts: "TTS",
  render: "Render",
};
