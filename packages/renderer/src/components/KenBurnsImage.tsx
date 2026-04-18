import React from "react";
import { Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export interface KenBurnsImageProps {
  src: string;
  /** このシーンの開始フレーム（composition 全体基準） */
  startFrame: number;
  /** このシーンのフレーム数 */
  durationFrames: number;
  /** 0-based index。方向ランダム化のシード */
  sceneIndex: number;
}

/**
 * 静止画に Ken Burns 風のスロー pan/zoom を適用。
 * シーンごとに方向を変えて単調さを避ける。
 */
export const KenBurnsImage: React.FC<KenBurnsImageProps> = ({
  src,
  startFrame,
  durationFrames,
  sceneIndex,
}) => {
  const frame = useCurrentFrame();
  const { width: videoWidth, height: videoHeight } = useVideoConfig();
  const localFrame = frame - startFrame;

  // 方向パターン（index の mod で循環）
  const patterns: Array<{
    scaleFrom: number;
    scaleTo: number;
    xFrom: number;
    xTo: number;
    yFrom: number;
    yTo: number;
  }> = [
    { scaleFrom: 1.0, scaleTo: 1.12, xFrom: 0, xTo: -25, yFrom: 0, yTo: -15 },
    { scaleFrom: 1.12, scaleTo: 1.0, xFrom: 20, xTo: 0, yFrom: 10, yTo: 0 },
    { scaleFrom: 1.05, scaleTo: 1.15, xFrom: -20, xTo: 15, yFrom: 0, yTo: 10 },
    { scaleFrom: 1.08, scaleTo: 1.02, xFrom: 0, xTo: 25, yFrom: -10, yTo: 5 },
  ];
  const pattern = patterns[sceneIndex % patterns.length]!;

  const scale = interpolate(localFrame, [0, durationFrames], [pattern.scaleFrom, pattern.scaleTo]);
  const translateX = interpolate(localFrame, [0, durationFrames], [pattern.xFrom, pattern.xTo]);
  const translateY = interpolate(localFrame, [0, durationFrames], [pattern.yFrom, pattern.yTo]);

  if (!src) {
    // 画像なしシーン: 暗グラデ背景
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
          width: videoWidth,
          height: videoHeight,
          objectFit: "cover",
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
};
