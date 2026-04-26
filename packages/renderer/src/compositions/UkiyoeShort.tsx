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
import { SfxAudio } from "../components/SfxAudio";

export interface UkiyoeShortProps {
  scenes: UkiyoeScene[];
  audioSrc: string;
  captions: CaptionWord[];
  captionSegments: CaptionSegment[];
  totalDurationSec: number;
  keyTerms?: string[];
  openingSfxSrc?: string;
  cheerSfxSrc?: string;
}

export const UkiyoeShort: React.FC<UkiyoeShortProps> = ({
  scenes,
  audioSrc,
  captionSegments,
  keyTerms = [],
  openingSfxSrc,
  cheerSfxSrc,
}) => {
  const { fps } = useVideoConfig();

  let cursor = 0;
  const layout = scenes.map((scene) => {
    const startFrame = Math.round(cursor * fps);
    const durationFrames = Math.max(1, Math.round(scene.durationSec * fps));
    cursor += scene.durationSec;
    return { scene, startFrame, durationFrames };
  });

  // 偶数 index (0, 2, 4, ...) のシーン末尾に男衆 SFX を鳴らす。
  // 末尾フレーム = 次シーンの startFrame。最終シーンが偶数なら末尾は動画終端のため省略。
  const cheerStartFrames = layout
    .filter(({ scene }) => scene.index % 2 === 0)
    .map(({ scene }) => layout.find((l) => l.scene.index === scene.index + 1))
    .filter((next): next is (typeof layout)[number] => next !== undefined)
    .map((next) => Math.max(0, next.startFrame - 2));

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

      <Caption
        captionSegments={captionSegments}
        keyTerms={keyTerms}
        variant="ukiyoe"
      />
      <NarrationAudio src={audioSrc} />
      {openingSfxSrc && <SfxAudio src={openingSfxSrc} startFrame={0} volume={1} />}
      {cheerSfxSrc &&
        cheerStartFrames.map((frame, i) => (
          <SfxAudio key={`cheer-${i}`} src={cheerSfxSrc} startFrame={frame} volume={0.8} />
        ))}
    </AbsoluteFill>
  );
};
