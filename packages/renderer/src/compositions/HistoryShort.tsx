import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { CaptionWord, ImageAsset, Scene } from "@rekishi/shared";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { KaraokeCaption } from "../components/KaraokeCaption";
import { NarrationAudio } from "../components/NarrationAudio";

export interface HistoryShortProps {
  scenes: Scene[];
  images: ImageAsset[];
  audioSrc: string;
  captions: CaptionWord[];
  totalDurationSec: number;
}

export const HistoryShort: React.FC<HistoryShortProps> = ({
  scenes,
  images,
  audioSrc,
  captions,
}) => {
  const { fps } = useVideoConfig();

  // scene ごとに開始フレームと duration を計算
  let cursor = 0;
  const layout = scenes.map((scene) => {
    const startFrame = Math.round(cursor * fps);
    const durationFrames = Math.max(1, Math.round(scene.durationSec * fps));
    cursor += scene.durationSec;
    const image = images.find((im) => im.sceneIndex === scene.index);
    return { scene, image, startFrame, durationFrames };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {layout.map(({ scene, image, startFrame, durationFrames }) => (
        <Sequence
          key={scene.index}
          from={startFrame}
          durationInFrames={durationFrames}
        >
          <KenBurnsImage
            src={image?.path ?? ""}
            startFrame={0}
            durationFrames={durationFrames}
            sceneIndex={scene.index}
          />
        </Sequence>
      ))}

      <KaraokeCaption words={captions} />
      <NarrationAudio src={audioSrc} />
    </AbsoluteFill>
  );
};
