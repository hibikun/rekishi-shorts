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

export const TtsStepSchema = StepBaseSchema.extend({
  voiceProvider: z.literal("gemini").default("gemini"),
  voiceName: z
    .string()
    .default("Charon")
    .describe(
      "Gemini TTS の prebuilt voice 名。例: Charon / Fenrir / Orus / Zubenelgenubi / Puck / Kore / Aoede / Leda",
    ),
  stylePromptOverride: z
    .string()
    .optional()
    .describe(
      "既定の style prompt を上書きするためのテキスト。空欄ならチャンネル既定を使用",
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
      "全シーン結合済み wav の相対パス。例: 'jobs/{jobId}/audio/full.wav' (channels/manabilab-canva 起点)。Canva へ 1 ファイルでアップロードする用",
    ),
  concatDurationSec: z
    .number()
    .optional()
    .describe("結合 wav の合計秒数"),
  concatGeneratedAt: z
    .string()
    .optional()
    .describe("結合 wav の生成日時 (ISO 8601)。個別 audioGeneratedAt より古ければ再結合推奨"),
});
export type TtsStepState = z.infer<typeof TtsStepSchema>;

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
    tts: TtsStepSchema,
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
