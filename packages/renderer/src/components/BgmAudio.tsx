import React from "react";
import { Audio, interpolate, useVideoConfig } from "remotion";

export interface BgmAudioProps {
  src: string;
  /** ベース音量 (0-1)。default 0.18 — ナレーションを邪魔しない控えめな値 */
  volume?: number;
  /** フェード IN 秒数。default 1 */
  fadeInSec?: number;
  /** フェード OUT 秒数。default 1.2 */
  fadeOutSec?: number;
  /** 動画全長 (秒)。フェード OUT のタイミング決定に使う */
  totalDurationSec: number;
}

/**
 * BGM 用 Audio コンポーネント。フェード IN / OUT 付き。
 * 1 動画につき 1 つだけ使う想定。
 */
export const BgmAudio: React.FC<BgmAudioProps> = ({
  src,
  volume = 0.18,
  fadeInSec = 1,
  fadeOutSec = 1.2,
  totalDurationSec,
}) => {
  const { fps } = useVideoConfig();
  const totalFrames = Math.ceil(totalDurationSec * fps);
  const fadeInFrames = Math.ceil(fadeInSec * fps);
  const fadeOutFrames = Math.ceil(fadeOutSec * fps);

  return (
    <Audio
      src={src}
      volume={(frame) => {
        if (frame < fadeInFrames) {
          return interpolate(frame, [0, fadeInFrames], [0, volume], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
        }
        if (frame > totalFrames - fadeOutFrames) {
          return interpolate(
            frame,
            [totalFrames - fadeOutFrames, totalFrames],
            [volume, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
        }
        return volume;
      }}
    />
  );
};
