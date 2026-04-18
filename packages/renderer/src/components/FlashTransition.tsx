import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export interface FlashTransitionProps {
  /** フラッシュ発生フレーム（composition全体基準） */
  boundaryFrames: number[];
  /** フラッシュの持続ミリ秒 */
  durationMs?: number;
  /** ピーク時の不透明度 */
  peakOpacity?: number;
}

/**
 * シーン切り替わり時に白フラッシュを重ねるオーバーレイ。
 * 短く・強めの輝きで「カット感」と「ショート動画らしいテンポ」を出す。
 */
export const FlashTransition: React.FC<FlashTransitionProps> = ({
  boundaryFrames,
  durationMs = 140,
  peakOpacity = 0.55,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flashHalf = Math.max(1, Math.round(((durationMs / 1000) * fps) / 2));

  // 最も近い境界との距離
  let opacity = 0;
  for (const b of boundaryFrames) {
    const dist = Math.abs(frame - b);
    if (dist <= flashHalf) {
      const o = interpolate(dist, [0, flashHalf], [peakOpacity, 0], { extrapolateRight: "clamp" });
      if (o > opacity) opacity = o;
    }
  }
  if (opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "#ffffff",
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};
