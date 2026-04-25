import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { CaptionSegment, CaptionWord, ImageAsset, Scene, VideoTitle } from "@rekishi/shared";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { Caption } from "../components/Caption";
import { NarrationAudio } from "../components/NarrationAudio";
import { KeywordPopup, type KeywordHit } from "../components/KeywordPopup";
import { TitleBar } from "../components/TitleBar";
import { SfxAudio } from "../components/SfxAudio";

export interface HistoryShortProps {
  scenes: Scene[];
  images: ImageAsset[];
  audioSrc: string;
  captions: CaptionWord[];
  captionSegments: CaptionSegment[];
  totalDurationSec: number;
  keyTerms?: string[];
  title?: VideoTitle;
  hookSfxSrc?: string;
  openingSfxSrc?: string;
}

const TITLE_BAR_RATIO = 0.25;

export const HistoryShort: React.FC<HistoryShortProps> = ({
  scenes,
  images,
  audioSrc,
  captions,
  captionSegments,
  totalDurationSec,
  keyTerms = [],
  title,
  hookSfxSrc,
  openingSfxSrc,
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

  // フック直後（scene[0] 終端 = scene[1] 開始）に SFX を鳴らす。
  // 攻撃音のピークがカットに揃うよう 2 frame だけ前倒しする。
  const hookSfxStartFrame = Math.max(0, (layout[1]?.startFrame ?? 0) - 2);

  const keywordHits: KeywordHit[] = keyTerms
    .map((term) => findKeywordHit(captions, term))
    .filter((h): h is KeywordHit => h !== null);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* 動画本体エリア: 上部25%のタイトル帯を避けて下75%に配置 */}
      <div
        style={{
          position: "absolute",
          top: `${TITLE_BAR_RATIO * 100}%`,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
        }}
      >
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
      </div>

      {title && <TitleBar top={title.top} bottom={title.bottom} />}
      <NarrationAudio src={audioSrc} />
      {openingSfxSrc && <SfxAudio src={openingSfxSrc} startFrame={0} />}
      {hookSfxSrc && <SfxAudio src={hookSfxSrc} startFrame={hookSfxStartFrame} />}
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
