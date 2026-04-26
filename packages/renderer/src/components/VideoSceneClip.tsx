import React from "react";
import { OffthreadVideo } from "remotion";

export interface VideoSceneClipProps {
  src: string;
}

/**
 * 浮世絵チャンネルのシーン用動画クリップ。Seedance で生成した mp4 を
 * 9:16 全画面で再生する。音声はナレーションを別途乗せるためミュート。
 */
export const VideoSceneClip: React.FC<VideoSceneClipProps> = ({ src }) => {
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
    <OffthreadVideo
      src={src}
      muted
      volume={0}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  );
};
