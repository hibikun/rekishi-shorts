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
import { SceneMotion } from "../components/SceneMotion";
import { resolveMotionGrammar } from "../motion";

export interface UkiyoeShortProps {
  scenes: UkiyoeScene[];
  audioSrc: string;
  captions: CaptionWord[];
  captionSegments: CaptionSegment[];
  totalDurationSec: number;
  keyTerms?: string[];
  openingSfxSrc?: string;
  cheerSfxSrc?: string;
  hitSfxSrc?: string;
  popSfxSrc?: string;
  whooshSfxSrc?: string;
}

export const UkiyoeShort: React.FC<UkiyoeShortProps> = ({
  scenes,
  audioSrc,
  captionSegments,
  keyTerms = [],
  openingSfxSrc,
  cheerSfxSrc,
  hitSfxSrc,
  popSfxSrc,
  whooshSfxSrc,
}) => {
  const { fps } = useVideoConfig();

  let cursor = 0;
  const layout = scenes.map((scene) => {
    const startFrame = Math.round(cursor * fps);
    const durationFrames = Math.max(1, Math.round(scene.durationSec * fps));
    cursor += scene.durationSec;
    const motion = resolveMotionGrammar(scene.motion, {
      index: scene.index,
      totalScenes: scenes.length,
      narration: scene.narration,
      actionTag: scene.actionTag,
    });
    return { scene, startFrame, durationFrames, motion };
  });

  // 偶数 index (0, 2, 4, ...) のシーン末尾に男衆 SFX を鳴らす。
  // 末尾フレーム = 次シーンの startFrame。最終シーンが偶数なら末尾は動画終端のため省略。
  const cheerStartFrames = layout
    .filter(({ scene }) => scene.index % 2 === 0)
    .map(({ scene }) => layout.find((l) => l.scene.index === scene.index + 1))
    .filter((next): next is (typeof layout)[number] => next !== undefined)
    .map((next) => Math.max(0, next.startFrame - 2));
  const motionKeyTerms = [
    ...keyTerms,
    ...layout.flatMap(({ motion }) => motion.emphasisWords),
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {layout.map(({ scene, startFrame, durationFrames, motion }) => (
        <Sequence
          key={scene.index}
          from={startFrame}
          durationInFrames={durationFrames}
        >
          <SceneMotion durationFrames={durationFrames} motion={motion}>
            <VideoSceneClip src={scene.videoPath} />
          </SceneMotion>
        </Sequence>
      ))}

      <Caption
        captionSegments={captionSegments}
        keyTerms={[...new Set(motionKeyTerms)]}
        variant="ukiyoe"
      />
      <NarrationAudio src={audioSrc} />
      {openingSfxSrc && <SfxAudio src={openingSfxSrc} startFrame={0} volume={1} />}
      {cheerSfxSrc &&
        cheerStartFrames.map((frame, i) => (
          <SfxAudio key={`cheer-${i}`} src={cheerSfxSrc} startFrame={frame} volume={0.8} />
        ))}
      {layout.map(({ startFrame, motion, scene }) => {
        const src =
          motion.sfxCue === "hit"
            ? hitSfxSrc
            : motion.sfxCue === "pop"
              ? popSfxSrc
              : motion.sfxCue === "whoosh"
                ? whooshSfxSrc
                : undefined;
        if (!src) return null;
        return (
          <SfxAudio
            key={`motion-sfx-${scene.index}`}
            src={src}
            startFrame={startFrame}
            volume={motion.energy === "high" ? 0.72 : 0.45}
          />
        );
      })}
    </AbsoluteFill>
  );
};
