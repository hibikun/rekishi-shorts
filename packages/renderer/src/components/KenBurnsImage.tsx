import React from "react";
import { Img, interpolate, useCurrentFrame } from "remotion";

export interface KenBurnsImageProps {
  src: string;
  startFrame: number;
  durationFrames: number;
  sceneIndex: number;
}

/**
 * 静止画にスロー pan/zoom を適用（v2: 控えめに）。
 * 1.5-3秒の短いシーンが連続するため Ken Burns は弱め。動きの方向だけ循環。
 */
export const KenBurnsImage: React.FC<KenBurnsImageProps> = ({
  src,
  startFrame,
  durationFrames,
  sceneIndex,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;

  // 控えめな pan/zoom パターン
  const patterns: Array<{
    scaleFrom: number;
    scaleTo: number;
    xFrom: number;
    xTo: number;
    yFrom: number;
    yTo: number;
  }> = [
    { scaleFrom: 1.02, scaleTo: 1.06, xFrom: 0, xTo: -10, yFrom: 0, yTo: -5 },
    { scaleFrom: 1.06, scaleTo: 1.02, xFrom: 8, xTo: 0, yFrom: 4, yTo: 0 },
    { scaleFrom: 1.03, scaleTo: 1.07, xFrom: -8, xTo: 6, yFrom: 0, yTo: 4 },
    { scaleFrom: 1.05, scaleTo: 1.01, xFrom: 0, xTo: 10, yFrom: -4, yTo: 2 },
  ];
  const pattern = patterns[sceneIndex % patterns.length]!;

  const scale = interpolate(localFrame, [0, durationFrames], [pattern.scaleFrom, pattern.scaleTo]);
  const translateX = interpolate(localFrame, [0, durationFrames], [pattern.xFrom, pattern.xTo]);
  const translateY = interpolate(localFrame, [0, durationFrames], [pattern.yFrom, pattern.yTo]);

  if (!src) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: "#000",
      }}
    >
      <Img
        src={src}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
      {/* 下部グラデーション: 字幕を読みやすくする */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "55%",
          background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.75) 80%)",
        }}
      />
    </div>
  );
};
