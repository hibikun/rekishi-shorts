import { z } from "zod";

export const TransitionInSchema = z.enum([
  "hard-cut",
  "swipe-left",
  "swipe-right",
  "snap-zoom",
  "blur-pop",
  "focus-in",
  "radial-zoom-blur",
]);
export type TransitionIn = z.infer<typeof TransitionInSchema>;

export const TransitionOutSchema = z.enum([
  "none",
  "whip",
  "focus-out",
  "push-away",
]);
export type TransitionOut = z.infer<typeof TransitionOutSchema>;

export const CameraMoveSchema = z.enum([
  "locked",
  "slow-push",
  "impact-zoom",
  "drift",
  "pull-in",
]);
export type CameraMove = z.infer<typeof CameraMoveSchema>;

export const MotionEnergySchema = z.enum(["low", "mid", "high"]);
export type MotionEnergy = z.infer<typeof MotionEnergySchema>;

export const SfxCueSchema = z.enum(["none", "hit", "whoosh", "pop"]);
export type SfxCue = z.infer<typeof SfxCueSchema>;

export const MotionGrammarSchema = z.object({
  transitionIn: TransitionInSchema.optional(),
  transitionOut: TransitionOutSchema.optional(),
  cameraMove: CameraMoveSchema.optional(),
  energy: MotionEnergySchema.optional(),
  sfxCue: SfxCueSchema.optional(),
  emphasisWords: z.array(z.string()).optional(),
});
export type MotionGrammar = z.infer<typeof MotionGrammarSchema>;
