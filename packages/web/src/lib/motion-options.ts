import type { MotionGrammar } from "@rekishi/shared";

export interface MotionPreset {
  id: string;
  label: string;
  description: string;
  motion?: MotionGrammar;
}

export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: "auto",
    label: "自動",
    description: "シーン内容からレンダラが自動推定",
  },
  {
    id: "snap-impact",
    label: "Snap Zoom",
    description: "冒頭フック向け。強く押し込む",
    motion: {
      transitionIn: "snap-zoom",
      transitionOut: "whip",
      cameraMove: "impact-zoom",
      energy: "high",
      sfxCue: "hit",
    },
  },
  {
    id: "radial-zoom-blur",
    label: "Radial Zoom Blur",
    description: "中心へ吸い込む強いズームブラーだけを追加",
    motion: {
      transitionIn: "radial-zoom-blur",
      transitionOut: "none",
      cameraMove: "locked",
      energy: "high",
      sfxCue: "whoosh",
    },
  },
  {
    id: "blur-pop",
    label: "Blur Pop",
    description: "数字・結論・意外性を強調",
    motion: {
      transitionIn: "blur-pop",
      transitionOut: "whip",
      cameraMove: "impact-zoom",
      energy: "high",
      sfxCue: "pop",
    },
  },
  {
    id: "focus-in",
    label: "Focus In",
    description: "ぼけから中心へ引き込む",
    motion: {
      transitionIn: "focus-in",
      transitionOut: "whip",
      cameraMove: "pull-in",
      energy: "high",
      sfxCue: "pop",
    },
  },
  {
    id: "swipe-left",
    label: "Swipe Left",
    description: "右から左へ入る通常転換",
    motion: {
      transitionIn: "swipe-left",
      transitionOut: "none",
      cameraMove: "slow-push",
      energy: "mid",
      sfxCue: "whoosh",
    },
  },
  {
    id: "swipe-right",
    label: "Swipe Right",
    description: "左から右へ入る通常転換",
    motion: {
      transitionIn: "swipe-right",
      transitionOut: "push-away",
      cameraMove: "drift",
      energy: "mid",
      sfxCue: "whoosh",
    },
  },
  {
    id: "focus-out",
    label: "Focus Out",
    description: "締め・余韻。ピントを外して消す",
    motion: {
      transitionIn: "hard-cut",
      transitionOut: "focus-out",
      cameraMove: "slow-push",
      energy: "low",
      sfxCue: "none",
    },
  },
  {
    id: "slow-push",
    label: "Slow Push",
    description: "説明パート向け。静かに寄る",
    motion: {
      transitionIn: "hard-cut",
      transitionOut: "none",
      cameraMove: "slow-push",
      energy: "low",
      sfxCue: "none",
    },
  },
];

export function presetForMotion(motion: MotionGrammar | undefined): string {
  if (!motion) return "auto";
  const found = MOTION_PRESETS.find((preset) => {
    if (!preset.motion) return false;
    return (
      preset.motion.transitionIn === motion.transitionIn &&
      preset.motion.transitionOut === motion.transitionOut &&
      preset.motion.cameraMove === motion.cameraMove &&
      preset.motion.energy === motion.energy &&
      preset.motion.sfxCue === motion.sfxCue
    );
  });
  return found?.id ?? "custom";
}

export function motionForPreset(id: string): MotionGrammar | undefined {
  const preset = MOTION_PRESETS.find((p) => p.id === id);
  if (!preset?.motion) return undefined;
  return { ...preset.motion };
}

export function motionSummary(motion: MotionGrammar | undefined): string {
  if (!motion) return "自動推定";
  return [
    motion.transitionIn,
    motion.cameraMove,
    motion.transitionOut,
    motion.energy,
  ]
    .filter(Boolean)
    .join(" / ");
}
