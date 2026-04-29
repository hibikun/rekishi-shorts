import { z } from "zod";
import { TopicSchema } from "./script.js";

export const StepStatusSchema = z.enum([
  "pending",
  "in-progress",
  "done",
  "error",
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

const StepBaseSchema = z.object({
  status: StepStatusSchema.default("pending"),
  updatedAt: z.string().optional(),
  error: z.string().optional(),
});

export const ResearchSourceSchema = z.object({
  uri: z.string(),
  title: z.string().optional(),
  domain: z.string().optional(),
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const ResearchStepSchema = StepBaseSchema.extend({
  sources: z.array(ResearchSourceSchema).default([]),
  queries: z.array(z.string()).default([]),
  model: z.string().optional(),
});
export type ResearchStepState = z.infer<typeof ResearchStepSchema>;

export const ScriptStepSchema = StepBaseSchema.extend({
  model: z.string().optional(),
  estimatedDurationSec: z.number().optional(),
});
export type ScriptStepState = z.infer<typeof ScriptStepSchema>;

export const ManabilabCanvaJobSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  topic: TopicSchema,
  steps: z.object({
    topic: StepBaseSchema,
    research: ResearchStepSchema,
    script: ScriptStepSchema,
    scenes: StepBaseSchema,
    images: StepBaseSchema,
    tts: StepBaseSchema,
    export: StepBaseSchema,
  }),
});
export type ManabilabCanvaJob = z.infer<typeof ManabilabCanvaJobSchema>;

export const STEP_ORDER = [
  "topic",
  "research",
  "script",
  "scenes",
  "images",
  "tts",
  "export",
] as const;
export type StepKey = (typeof STEP_ORDER)[number];

export const STEP_LABELS: Record<StepKey, string> = {
  topic: "Topic",
  research: "Research",
  script: "Script",
  scenes: "Scenes",
  images: "Images",
  tts: "TTS",
  export: "Export",
};
