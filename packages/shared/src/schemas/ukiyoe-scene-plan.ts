import { z } from "zod";
import { UkiyoeActionTagSchema } from "./ukiyoe-plan";
import { MotionGrammarSchema } from "./motion";

export const UkiyoeSceneSpecSchema = z.object({
  index: z.number().int().nonnegative(),
  narration: z.string(),
  durationSec: z.number().positive(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
  videoPromptJa: z.string().default(""),
  actionTag: UkiyoeActionTagSchema,
  cameraFixed: z.boolean().optional(),
  motion: MotionGrammarSchema.optional(),
});
export type UkiyoeSceneSpec = z.infer<typeof UkiyoeSceneSpecSchema>;

export const UkiyoeScenePlanSchema = z.object({
  topic: z.string(),
  totalDurationSec: z.number().positive(),
  scenes: z.array(UkiyoeSceneSpecSchema),
});
export type UkiyoeScenePlan = z.infer<typeof UkiyoeScenePlanSchema>;
