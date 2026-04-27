import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type {
  CaptionSegment,
  CaptionWord,
  KoseiAnimationScene,
  VideoTitle,
} from "@rekishi/shared";
import { VideoSceneClip } from "../components/VideoSceneClip";
import { Caption } from "../components/Caption";
import { NarrationAudio } from "../components/NarrationAudio";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export interface KoseiAnimationShortProps {
  scenes: KoseiAnimationScene[];
  audioSrc: string;
  captions: CaptionWord[];
  captionSegments: CaptionSegment[];
  totalDurationSec: number;
  keyTerms?: string[];
  title?: VideoTitle;
}

export const KoseiAnimationShort: React.FC<KoseiAnimationShortProps> = ({
  scenes,
  audioSrc,
  captionSegments,
  keyTerms = [],
  title,
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

      {title && (
        <div
          style={{
            position: "absolute",
            top: 54,
            left: 42,
            right: 42,
            zIndex: 20,
            fontFamily: FONT_FAMILY,
            color: "#fff",
            textShadow: "0 3px 14px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.9)",
            lineHeight: 1.05,
            letterSpacing: 0,
          }}
        >
          {title.top && (
            <div
              style={{
                fontSize: 42,
                fontWeight: 800,
                marginBottom: 8,
              }}
            >
              {title.top}
            </div>
          )}
          <div
            style={{
              fontSize: 72,
              fontWeight: 900,
              overflowWrap: "anywhere",
            }}
          >
            {title.bottom}
          </div>
        </div>
      )}

      <Caption captionSegments={captionSegments} keyTerms={keyTerms} />
      <NarrationAudio src={audioSrc} />
    </AbsoluteFill>
  );
};
