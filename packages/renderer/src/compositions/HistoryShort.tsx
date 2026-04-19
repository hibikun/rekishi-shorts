import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { CaptionSegment, CaptionWord, ImageAsset, Scene } from "@rekishi/shared";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { Caption } from "../components/Caption";
import { NarrationAudio } from "../components/NarrationAudio";
import { KeywordPopup, type KeywordHit } from "../components/KeywordPopup";
import { TeaserCard } from "../components/TeaserCard";

export interface HistoryShortProps {
  scenes: Scene[];
  images: ImageAsset[];
  audioSrc: string;
  captions: CaptionWord[];
  captionSegments: CaptionSegment[];
  totalDurationSec: number;
  keyTerms?: string[];
  teaserCaption?: string;
}

const TEASER_HOLD_SEC = 1.0;
const TEASER_FADE_SEC = 0.3;

export const HistoryShort: React.FC<HistoryShortProps> = ({
  scenes,
  images,
  audioSrc,
  captions,
  captionSegments,
  keyTerms = [],
  teaserCaption,
}) => {
  const { fps } = useVideoConfig();
  const hasTeaser = Boolean(teaserCaption && teaserCaption.trim().length > 0);

  let cursor = 0;
  const layout = scenes.map((scene) => {
    const startFrame = Math.round(cursor * fps);
    const durationFrames = Math.max(1, Math.round(scene.durationSec * fps));
    cursor += scene.durationSec;
    const image = images.find((im) => im.sceneIndex === scene.index);
    return { scene, image, startFrame, durationFrames };
  });

  const keywordHits: KeywordHit[] = keyTerms
    .map((term) => findKeywordHit(captions, term))
    .filter((h): h is KeywordHit => h !== null);

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
      <KeywordPopup hits={keywordHits} />
      {hasTeaser && (
        <TeaserCard text={teaserCaption!} holdSec={TEASER_HOLD_SEC} fadeSec={TEASER_FADE_SEC} />
      )}
      <NarrationAudio src={audioSrc} />
    </AbsoluteFill>
  );
};

function findKeywordHit(words: CaptionWord[], term: string): KeywordHit | null {
  const normalizedTerm = term.replace(/\s+/g, "");
  if (!normalizedTerm) return null;
  for (let i = 0; i < words.length; i++) {
    let combined = "";
    for (let j = i; j < Math.min(words.length, i + 6); j++) {
      combined += words[j]!.text;
      if (combined.includes(normalizedTerm)) {
        return {
          term,
          startSec: words[i]!.startSec,
          endSec: words[j]!.endSec,
        };
      }
      if (combined.length > normalizedTerm.length * 2) break;
    }
  }
  return null;
}
