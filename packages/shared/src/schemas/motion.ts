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

export const DesignMotionPresetSchema = z.enum([
  "fade",
  "rise",
  "pop",
  "breathe",
  "drift",
  "stomp",
  "wipe",
  "typewriter",
]);
export type DesignMotionPreset = z.infer<typeof DesignMotionPresetSchema>;

export const DesignMotionPhaseSchema = z.enum(["enter", "loop", "exit"]);
export type DesignMotionPhase = z.infer<typeof DesignMotionPhaseSchema>;

export const DesignMotionTargetSchema = z.enum([
  "element",
  "line",
  "word",
  "character",
]);
export type DesignMotionTarget = z.infer<typeof DesignMotionTargetSchema>;

export const DesignMotionDirectionSchema = z.enum([
  "up",
  "down",
  "left",
  "right",
]);
export type DesignMotionDirection = z.infer<typeof DesignMotionDirectionSchema>;

export const DesignMotionEasingSchema = z.enum([
  "linear",
  "easeOut",
  "easeInOut",
  "spring",
]);
export type DesignMotionEasing = z.infer<typeof DesignMotionEasingSchema>;

export const DesignMotionSpecSchema = z.object({
  preset: DesignMotionPresetSchema,
  phase: DesignMotionPhaseSchema.default("enter"),
  target: DesignMotionTargetSchema.default("element"),
  direction: DesignMotionDirectionSchema.optional(),
  startFrame: z.number().int().nonnegative().default(0),
  durationFrames: z.number().int().positive().default(18),
  staggerFrames: z.number().int().nonnegative().default(0),
  intensity: z.number().min(0).max(2).default(1),
  easing: DesignMotionEasingSchema.optional(),
});
export type DesignMotionSpec = z.infer<typeof DesignMotionSpecSchema>;
