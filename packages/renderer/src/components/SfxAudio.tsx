import React from "react";
import { Audio, Sequence } from "remotion";

export interface SfxAudioProps {
  src: string;
  startFrame: number;
  volume?: number;
}

export const SfxAudio: React.FC<SfxAudioProps> = ({ src, startFrame, volume = 0.6 }) => {
  if (!src) return null;
  return (
    <Sequence from={startFrame}>
      <Audio src={src} volume={volume} />
    </Sequence>
  );
};
