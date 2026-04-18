import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionWord } from "@rekishi/shared";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";

const { fontFamily } = loadFont();

export interface KaraokeCaptionProps {
  words: CaptionWord[];
  /** 一度に表示する単語数 */
  phraseWordCount?: number;
}

/**
 * v2: 文節単位の少量表示、太字ピル状背景で読みやすく。
 */
export const KaraokeCaption: React.FC<KaraokeCaptionProps> = ({
  words,
  phraseWordCount = 4,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: videoWidth, height: videoHeight } = useVideoConfig();
  const currentSec = frame / fps;

  if (words.length === 0) return null;
  if (currentSec < (words[0]?.startSec ?? Infinity)) return null;

  const activeIndex = words.findIndex((w) => currentSec >= w.startSec && currentSec < w.endSec);
  const centerIndex = activeIndex === -1
    ? Math.max(0, words.findIndex((w) => w.startSec > currentSec) - 1)
    : activeIndex;
  const start = Math.max(0, centerIndex - Math.floor(phraseWordCount / 2));
  const phrase = words.slice(start, start + phraseWordCount);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: videoHeight * 0.14,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 48px",
        width: videoWidth,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: "6px 10px",
          background: "rgba(0,0,0,0.72)",
          padding: "20px 32px",
          borderRadius: 18,
          maxWidth: "92%",
        }}
      >
        {phrase.map((w, i) => {
          const isActive = currentSec >= w.startSec && currentSec < w.endSec;
          return (
            <span
              key={start + i}
              style={{
                fontFamily,
                fontWeight: 900,
                fontSize: 64,
                lineHeight: 1.25,
                color: isActive ? "#FFD54F" : "#ffffff",
                transform: isActive ? "scale(1.06)" : "scale(1)",
                transition: "transform 70ms ease-out, color 60ms linear",
                display: "inline-block",
                textShadow: isActive ? "0 0 14px rgba(255,213,79,0.55)" : "none",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
