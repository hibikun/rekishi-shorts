import React from "react";
import { Audio, useVideoConfig } from "remotion";

interface BgmAudioProps {
  src: string;
  volume: number;
  totalDurationSec: number;
}

export const BgmAudio: React.FC<BgmAudioProps> = ({ src, volume, totalDurationSec }) => {
  const { fps } = useVideoConfig();
  if (!src) return null;
  const safeVolume = Math.max(0, Math.min(1, volume));
  const endAt = Math.max(1, Math.round(totalDurationSec * fps));
  return <Audio src={src} volume={safeVolume} loop endAt={endAt} />;
};
