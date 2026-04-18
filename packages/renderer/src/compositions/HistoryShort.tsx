import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { CaptionWord, ImageAsset, Scene } from "@rekishi/shared";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { KaraokeCaption } from "../components/KaraokeCaption";
import { NarrationAudio } from "../components/NarrationAudio";
import { FlashTransition } from "../components/FlashTransition";
import { KeywordPopup, type KeywordHit } from "../components/KeywordPopup";

export interface HistoryShortProps {
  scenes: Scene[];
  images: ImageAsset[];
  audioSrc: string;
  captions: CaptionWord[];
  totalDurationSec: number;
  keyTerms?: string[];
}

export const HistoryShort: React.FC<HistoryShortProps> = ({
  scenes,
  images,
  audioSrc,
  captions,
  keyTerms = [],
}) => {
  const { fps } = useVideoConfig();

  // scene layout: from / duration
  let cursor = 0;
  const layout = scenes.map((scene) => {
    const startFrame = Math.round(cursor * fps);
    const durationFrames = Math.max(1, Math.round(scene.durationSec * fps));
    cursor += scene.durationSec;
    const image = images.find((im) => im.sceneIndex === scene.index);
    return { scene, image, startFrame, durationFrames };
  });

  // 境界フレーム (0番除く: hero scene は fade-in じゃなく開幕)
  const boundaryFrames = layout.slice(1).map((l) => l.startFrame);

  // keyTerm → caption words から最初に出現する時間を検出
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

      <KaraokeCaption words={captions} />
      <KeywordPopup hits={keywordHits} />
      <FlashTransition boundaryFrames={boundaryFrames} />
      <NarrationAudio src={audioSrc} />
    </AbsoluteFill>
  );
};

/** captions の連続window で term 文字列にマッチするものを探す (文字結合で探索) */
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
