import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import type { ResolvedMotionGrammar } from "../motion";

export interface SceneMotionProps {
  durationFrames: number;
  motion: ResolvedMotionGrammar;
  children: React.ReactNode;
}

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export const SceneMotion: React.FC<SceneMotionProps> = ({
  durationFrames,
  motion,
  children,
}) => {
  const frame = useCurrentFrame();
  const entranceFrames = motion.energy === "high" ? 8 : 6;
  const exitFrames = motion.energy === "high" ? 9 : 7;
  const exitStart = Math.max(0, durationFrames - exitFrames);

  let opacity = 1;
  let x = 0;
  let y = 0;
  let scale = 1;
  let rotate = 0;
  let blur = 0;
  let brightness = 1;

  if (motion.transitionIn === "swipe-left") {
    x += interpolate(frame, [0, entranceFrames], [1080, 0], clamp);
    blur += interpolate(frame, [0, entranceFrames], [8, 0], clamp);
  } else if (motion.transitionIn === "swipe-right") {
    x += interpolate(frame, [0, entranceFrames], [-1080, 0], clamp);
    blur += interpolate(frame, [0, entranceFrames], [8, 0], clamp);
  } else if (motion.transitionIn === "snap-zoom") {
    scale *= interpolate(frame, [0, 2, entranceFrames], [1.24, 1.07, 1], clamp);
    opacity *= interpolate(frame, [0, 2], [0.75, 1], clamp);
    brightness *= interpolate(frame, [0, 4, entranceFrames], [1.35, 1.08, 1], clamp);
  } else if (motion.transitionIn === "blur-pop") {
    scale *= interpolate(frame, [0, entranceFrames], [1.13, 1], clamp);
    opacity *= interpolate(frame, [0, entranceFrames], [0, 1], clamp);
    blur += interpolate(frame, [0, entranceFrames], [18, 0], clamp);
  } else if (motion.transitionIn === "focus-in") {
    scale *= interpolate(frame, [0, 4, entranceFrames + 4], [0.9, 1.08, 1], clamp);
    opacity *= interpolate(frame, [0, 4], [0.35, 1], clamp);
    blur += interpolate(frame, [0, 5, entranceFrames + 4], [28, 9, 0], clamp);
    brightness *= interpolate(frame, [0, 5, entranceFrames + 4], [0.72, 1.22, 1], clamp);
  } else if (motion.transitionIn === "radial-zoom-blur") {
    scale *= interpolate(frame, [0, 5, entranceFrames + 6], [1.22, 1.08, 1], clamp);
    blur += interpolate(frame, [0, 5, entranceFrames + 6], [22, 9, 0], clamp);
    brightness *= interpolate(frame, [0, 4, entranceFrames + 6], [1.25, 1.12, 1], clamp);
  }

  if (motion.cameraMove === "slow-push") {
    scale *= interpolate(frame, [0, durationFrames], [1, 1.035], clamp);
  } else if (motion.cameraMove === "impact-zoom") {
    scale *= interpolate(frame, [0, 4, 13, durationFrames], [1.02, 1.09, 1.01, 1.035], clamp);
    const shake = Math.max(0, 1 - frame / 10);
    x += Math.sin(frame * 1.9) * 9 * shake;
    y += Math.cos(frame * 2.4) * 6 * shake;
  } else if (motion.cameraMove === "drift") {
    x += Math.sin(frame * 0.035) * 9;
    y += Math.cos(frame * 0.028) * 7;
    scale *= 1.018;
  } else if (motion.cameraMove === "pull-in") {
    scale *= interpolate(frame, [0, durationFrames], [0.985, 1.075], clamp);
    y += interpolate(frame, [0, durationFrames], [10, -8], clamp);
  }

  if (frame >= exitStart) {
    if (motion.transitionOut === "whip") {
      x += interpolate(frame, [exitStart, durationFrames], [0, -300], clamp);
      rotate += interpolate(frame, [exitStart, durationFrames], [0, -1.2], clamp);
      blur += interpolate(frame, [exitStart, durationFrames], [0, 14], clamp);
      opacity *= interpolate(frame, [exitStart, durationFrames], [1, 0.35], clamp);
    } else if (motion.transitionOut === "focus-out") {
      blur += interpolate(frame, [exitStart, durationFrames], [0, 20], clamp);
      scale *= interpolate(frame, [exitStart, durationFrames], [1, 1.06], clamp);
      opacity *= interpolate(frame, [exitStart, durationFrames], [1, 0.25], clamp);
      brightness *= interpolate(frame, [exitStart, durationFrames], [1, 0.82], clamp);
    } else if (motion.transitionOut === "push-away") {
      scale *= interpolate(frame, [exitStart, durationFrames], [1, 0.86], clamp);
      opacity *= interpolate(frame, [exitStart, durationFrames], [1, 0.2], clamp);
      blur += interpolate(frame, [exitStart, durationFrames], [0, 10], clamp);
    }
  }

  const radialBurst =
    motion.transitionIn === "radial-zoom-blur"
      ? interpolate(frame, [0, 5, entranceFrames + 6], [1, 0.75, 0], clamp)
      : 0;

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      {radialBurst > 0 &&
        [0, 1, 2, 3, 4].map((index) => (
          <AbsoluteFill
            key={index}
            style={{
              opacity: radialBurst * (0.22 - index * 0.028),
              transform: `scale(${1.08 + index * 0.095})`,
              transformOrigin: "center center",
              filter: `blur(${8 + index * 7}px) brightness(${1.05 + radialBurst * 0.18})`,
            }}
          >
            {children}
          </AbsoluteFill>
        ))}
      <AbsoluteFill
        style={{
          opacity,
          transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scale})`,
          transformOrigin: "center center",
          filter: `blur(${blur}px) brightness(${brightness})`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
