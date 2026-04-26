import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type {
  CaptionSegment,
  CaptionWord,
  UkiyoeScene,
} from "@rekishi/shared";
import { VideoSceneClip } from "../components/VideoSceneClip";
import { Caption } from "../components/Caption";
import { NarrationAudio } from "../components/NarrationAudio";

export interface UkiyoeShortProps {
  scenes: UkiyoeScene[];
  audioSrc: string;
  captions: CaptionWord[];
  captionSegments: CaptionSegment[];
  totalDurationSec: number;
  keyTerms?: string[];
}

export const UkiyoeShort: React.FC<UkiyoeShortProps> = ({
  scenes,
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
    return { scene, startFrame, durationFrames };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {layout.map(({ scene, startFrame, durationFrames }) => (
        <Sequence
          key={scene.index}
          from={startFrame}
          durationInFrames={durationFrames}
        >
          <VideoSceneClip src={scene.videoPath} />
        </Sequence>
      ))}

      <Caption captionSegments={captionSegments} keyTerms={keyTerms} />
      <NarrationAudio src={audioSrc} />
    </AbsoluteFill>
  );
};
