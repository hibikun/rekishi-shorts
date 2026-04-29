import type { DesignMotionEasing } from "@rekishi/shared";

export const clampInterpolation = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

export function applyDesignEasing(
  progress: number,
  easing: DesignMotionEasing | undefined,
): number {
  const t = clamp01(progress);
  if (easing === "linear") return t;
  if (easing === "easeInOut") return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  if (easing === "spring") return 1 - Math.cos(t * Math.PI * 2.2) * Math.exp(-5.2 * t);
  return 1 - Math.pow(1 - t, 3);
}

export function backOut(progress: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = clamp01(progress) - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
}
