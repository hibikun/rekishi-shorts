import React from "react";
import { Audio } from "remotion";

export const NarrationAudio: React.FC<{ src: string }> = ({ src }) => {
  if (!src) return null;
  return <Audio src={src} />;
};
