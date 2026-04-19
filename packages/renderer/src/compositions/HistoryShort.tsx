import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { CaptionSegment, CaptionWord, ImageAsset, Scene } from "@rekishi/shared";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { Caption } from "../components/Caption";
import { NarrationAudio } from "../components/NarrationAudio";

export interface HistoryShortProps {
  scenes: Scene[];
  images: ImageAsset[];
  audioSrc: string;
  captions: CaptionWord[];
  captionSegments: CaptionSegment[];
  totalDurationSec: number;
  keyTerms?: string[];
}

export const HistoryShort: React.FC<HistoryShortProps> = ({
  scenes,
  images,
  audioSrc,
  captionSegments,
  keyTerms = [],
}) => {
  const { fps } = useVideoConfig();

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

      <Caption captionSegments={captionSegments} keyTerms={keyTerms} />
      <NarrationAudio src={audioSrc} />
    </AbsoluteFill>
  );
};
