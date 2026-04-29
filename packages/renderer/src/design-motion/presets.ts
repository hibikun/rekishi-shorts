import type React from "react";
import type {
  DesignMotionDirection,
  DesignMotionSpec,
} from "@rekishi/shared";
import { applyDesignEasing, backOut, clamp01, mix } from "./easing";

export interface ResolveDesignMotionStyleInput {
  frame: number;
  spec: DesignMotionSpec;
  itemIndex?: number;
}

interface MotionValues {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  blur: number;
  clipPath?: string;
}

const DEFAULT_DISTANCE = 44;

export function resolveDesignMotionStyle({
  frame,
  spec,
  itemIndex = 0,
}: ResolveDesignMotionStyleInput): React.CSSProperties {
  const startFrame = spec.startFrame + itemIndex * spec.staggerFrames;
  const durationFrames = Math.max(1, spec.durationFrames);
  const localFrame = frame - startFrame;
  const rawProgress = localFrame / durationFrames;
  const progress = clamp01(rawProgress);
  const eased = applyDesignEasing(progress, spec.easing);
  const intensity = spec.intensity;
  const values: MotionValues = {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotate: 0,
    blur: 0,
  };

  if (spec.phase === "enter" && localFrame < 0) {
    values.opacity = 0;
  }
  if (spec.phase === "exit" && localFrame >= durationFrames) {
    values.opacity = 0;
  }

  if (spec.preset === "fade") {
    applyFade(values, spec.phase, eased);
  } else if (spec.preset === "rise") {
    applyRise(values, spec.phase, eased, spec.direction ?? "up", intensity);
  } else if (spec.preset === "pop") {
    applyPop(values, spec.phase, progress, intensity);
  } else if (spec.preset === "breathe") {
    applyBreathe(values, spec.phase, localFrame, durationFrames, intensity);
  } else if (spec.preset === "drift") {
    applyDrift(values, spec.phase, localFrame, durationFrames, spec.direction ?? "up", intensity);
  } else if (spec.preset === "stomp") {
    applyStomp(values, spec.phase, progress, intensity);
  } else if (spec.preset === "wipe") {
    applyWipe(values, spec.phase, eased, spec.direction ?? "right");
  } else if (spec.preset === "typewriter") {
    applyFade(values, spec.phase, eased);
  }

  const filterParts: string[] = [];
  if (values.blur > 0.01) filterParts.push(`blur(${values.blur.toFixed(2)}px)`);

  return {
    opacity: values.opacity,
    transform: `translate(${values.x.toFixed(2)}px, ${values.y.toFixed(2)}px) rotate(${values.rotate.toFixed(3)}deg) scale(${values.scale.toFixed(4)}) scaleX(${values.scaleX.toFixed(4)}) scaleY(${values.scaleY.toFixed(4)})`,
    transformOrigin: "center center",
    filter: filterParts.length > 0 ? filterParts.join(" ") : undefined,
    clipPath: values.clipPath,
    willChange: "transform, opacity, filter, clip-path",
  };
}

function applyFade(values: MotionValues, phase: DesignMotionSpec["phase"], eased: number): void {
  if (phase === "enter") values.opacity *= eased;
  if (phase === "exit") values.opacity *= 1 - eased;
}

function applyRise(
  values: MotionValues,
  phase: DesignMotionSpec["phase"],
  eased: number,
  direction: DesignMotionDirection,
  intensity: number,
): void {
  const distance = DEFAULT_DISTANCE * intensity;
  const remaining = phase === "exit" ? eased : 1 - eased;
  const sign = phase === "exit" ? -1 : 1;
  values.opacity *= phase === "exit" ? 1 - eased : eased;

  if (direction === "up") values.y += distance * remaining * sign;
  if (direction === "down") values.y -= distance * remaining * sign;
  if (direction === "left") values.x += distance * remaining * sign;
  if (direction === "right") values.x -= distance * remaining * sign;
  values.blur += phase === "exit" ? mix(0, 5 * intensity, eased) : mix(5 * intensity, 0, eased);
}

function applyPop(
  values: MotionValues,
  phase: DesignMotionSpec["phase"],
  progress: number,
  intensity: number,
): void {
  if (phase === "exit") {
    const eased = applyDesignEasing(progress, "easeOut");
    values.opacity *= 1 - eased;
    values.scale *= mix(1, 0.82, eased);
    values.blur += mix(0, 4 * intensity, eased);
    return;
  }

  const eased = backOut(progress);
  values.opacity *= applyDesignEasing(progress, "easeOut");
  values.scale *= mix(0.72, 1, eased) + Math.sin(progress * Math.PI) * 0.035 * intensity;
}

function applyStomp(
  values: MotionValues,
  phase: DesignMotionSpec["phase"],
  progress: number,
  intensity: number,
): void {
  if (phase === "exit") {
    const eased = applyDesignEasing(progress, "easeOut");
    values.opacity *= 1 - eased;
    values.y += mix(0, 46 * intensity, eased);
    values.scaleX *= mix(1, 1.08, eased);
    values.scaleY *= mix(1, 0.72, eased);
    values.blur += mix(0, 5 * intensity, eased);
    return;
  }

  if (phase === "loop") {
    applyBreathe(values, phase, progress * 100, 100, intensity * 0.35);
    return;
  }

  const p = clamp01(progress);
  values.opacity *= p < 0.08 ? mix(0, 1, p / 0.08) : 1;
  values.y += keyframes(p, [
    [0, -92 * intensity],
    [0.36, -18 * intensity],
    [0.47, 0],
    [0.62, -13 * intensity],
    [0.76, 0],
    [1, 0],
  ]);
  values.scaleX *= keyframes(p, [
    [0, 1.04],
    [0.36, 1.02],
    [0.47, 1.16],
    [0.62, 0.96],
    [0.76, 1.035],
    [1, 1],
  ]);
  values.scaleY *= keyframes(p, [
    [0, 1.1],
    [0.36, 1.04],
    [0.47, 0.78],
    [0.62, 1.09],
    [0.76, 0.97],
    [1, 1],
  ]);
  values.rotate += keyframes(p, [
    [0, -2.2 * intensity],
    [0.47, 0.9 * intensity],
    [0.62, -0.55 * intensity],
    [0.76, 0.22 * intensity],
    [1, 0],
  ]);
  values.blur += keyframes(p, [
    [0, 4.5 * intensity],
    [0.36, 1.5 * intensity],
    [0.47, 0],
    [1, 0],
  ]);
}

function applyBreathe(
  values: MotionValues,
  phase: DesignMotionSpec["phase"],
  localFrame: number,
  durationFrames: number,
  intensity: number,
): void {
  if (phase !== "loop") {
    applyFade(values, phase, applyDesignEasing(clamp01(localFrame / durationFrames), "easeOut"));
  }
  const cycle = Math.max(0, localFrame) / Math.max(1, durationFrames);
  const wave = (Math.sin(cycle * Math.PI * 2) + 1) / 2;
  values.scale *= 1 + mix(-0.006, 0.018, wave) * intensity;
  values.opacity *= 0.96 + wave * 0.04;
}

function applyDrift(
  values: MotionValues,
  phase: DesignMotionSpec["phase"],
  localFrame: number,
  durationFrames: number,
  direction: DesignMotionDirection,
  intensity: number,
): void {
  if (phase !== "loop") {
    applyFade(values, phase, applyDesignEasing(clamp01(localFrame / durationFrames), "easeOut"));
  }
  const frame = Math.max(0, localFrame);
  const amp = 12 * intensity;
  const primary = Math.sin(frame * 0.035) * amp;
  const secondary = Math.cos(frame * 0.027) * amp * 0.45;
  if (direction === "left" || direction === "right") {
    values.x += direction === "left" ? -primary : primary;
    values.y += secondary;
  } else {
    values.y += direction === "up" ? -primary : primary;
    values.x += secondary;
  }
}

function applyWipe(
  values: MotionValues,
  phase: DesignMotionSpec["phase"],
  eased: number,
  direction: DesignMotionDirection,
): void {
  const amount = phase === "exit" ? eased * 100 : (1 - eased) * 100;
  if (phase === "enter") values.opacity *= eased > 0.02 ? 1 : 0;
  if (phase === "exit") values.opacity *= 1 - eased;

  if (direction === "right") values.clipPath = `inset(0 ${amount.toFixed(2)}% 0 0)`;
  if (direction === "left") values.clipPath = `inset(0 0 0 ${amount.toFixed(2)}%)`;
  if (direction === "up") values.clipPath = `inset(0 0 ${amount.toFixed(2)}% 0)`;
  if (direction === "down") values.clipPath = `inset(${amount.toFixed(2)}% 0 0 0)`;
}

function keyframes(progress: number, frames: Array<[number, number]>): number {
  const p = clamp01(progress);
  const first = frames[0];
  if (!first) return 0;
  if (p <= first[0]) return first[1];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]!;
    const next = frames[i]!;
    if (p <= next[0]) {
      const local = (p - prev[0]) / Math.max(0.0001, next[0] - prev[0]);
      return mix(prev[1], next[1], applyDesignEasing(local, "easeInOut"));
    }
  }

  return frames[frames.length - 1]?.[1] ?? 0;
}
