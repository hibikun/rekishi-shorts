import type {
  CameraMove,
  MotionEnergy,
  MotionGrammar,
  SfxCue,
  TransitionIn,
  TransitionOut,
} from "@rekishi/shared";

export interface ResolvedMotionGrammar {
  transitionIn: TransitionIn;
  transitionOut: TransitionOut;
  cameraMove: CameraMove;
  energy: MotionEnergy;
  sfxCue: SfxCue;
  emphasisWords: string[];
}

export interface MotionContext {
  index: number;
  totalScenes: number;
  narration?: string;
  actionTag?: string;
}

const HIGH_ENERGY_ACTIONS = new Set([
  "running_forward",
  "drawing_sword",
  "crowd_cheering",
  "weather_dynamic",
]);

const EMPHASIS_RE = /[0-9０-９%％]|倍|以上|だけ|原因|本当|結論|なぜ|実は|しかし|でも|驚|低下|定着/u;

export function resolveMotionGrammar(
  motion: MotionGrammar | undefined,
  context: MotionContext,
): ResolvedMotionGrammar {
  const inferredEnergy = inferEnergy(context);
  const energy = motion?.energy ?? inferredEnergy;
  const isLast = context.index >= context.totalScenes - 1;

  return {
    energy,
    transitionIn: motion?.transitionIn ?? inferTransitionIn(context, energy),
    transitionOut: motion?.transitionOut ?? (isLast ? "focus-out" : inferTransitionOut(context, energy)),
    cameraMove: motion?.cameraMove ?? inferCameraMove(context, energy),
    sfxCue: motion?.sfxCue ?? inferSfxCue(context, energy),
    emphasisWords: motion?.emphasisWords ?? inferEmphasisWords(context.narration ?? ""),
  };
}

function inferEnergy(context: MotionContext): MotionEnergy {
  if (context.index === 0) return "high";
  if (HIGH_ENERGY_ACTIONS.has(context.actionTag ?? "")) return "high";
  if (EMPHASIS_RE.test(context.narration ?? "")) return "high";
  if (context.index % 3 === 0) return "mid";
  return "low";
}

function inferTransitionIn(
  context: MotionContext,
  energy: MotionEnergy,
): TransitionIn {
  if (context.index === 0) return "radial-zoom-blur";
  if (energy === "high") return "blur-pop";
  if (context.index % 2 === 0) return "swipe-left";
  return "hard-cut";
}

function inferTransitionOut(
  context: MotionContext,
  energy: MotionEnergy,
): TransitionOut {
  if (energy === "high") return "whip";
  if (context.index % 3 === 2) return "push-away";
  return "none";
}

function inferCameraMove(
  context: MotionContext,
  energy: MotionEnergy,
): CameraMove {
  if (energy === "high") return "impact-zoom";
  if (context.actionTag === "still_subtle" || context.actionTag === "sleeping") {
    return "slow-push";
  }
  if (energy === "mid") return "drift";
  return "slow-push";
}

function inferSfxCue(context: MotionContext, energy: MotionEnergy): SfxCue {
  if (context.index === 0) return "hit";
  if (energy === "high") return "pop";
  if (context.index % 2 === 0) return "whoosh";
  return "none";
}

function inferEmphasisWords(narration: string): string[] {
  const matches = narration.match(/[0-9０-９]+(?:%|％|倍|時間|日|つ目)?|[^、。]*?(?:だけ|原因|本当|結論|低下|定着)[^、。]*/gu);
  return [...new Set((matches ?? []).map((m) => m.trim()).filter(Boolean))].slice(0, 3);
}
