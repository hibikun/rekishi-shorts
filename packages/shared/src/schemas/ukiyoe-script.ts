import { z } from "zod";

export const UkiyoeScriptModeSchema = z.enum(["routine", "life"]);
export type UkiyoeScriptMode = z.infer<typeof UkiyoeScriptModeSchema>;

export const UkiyoeScriptSchema = z.object({
  topic: z.string(),
  era: z.string().nullable(),
  hook: z.string(),
  narration: z.string(),
  keyTerms: z.array(z.string()).default([]),
  readings: z.record(z.string(), z.string()).default({}),
  estimatedDurationSec: z.number(),
  targetSceneCount: z.number().int().positive(),
});
export type UkiyoeScript = z.infer<typeof UkiyoeScriptSchema>;
