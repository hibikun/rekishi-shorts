import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionWord } from "@rekishi/shared";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";

const { fontFamily } = loadFont();

export interface KaraokeCaptionProps {
  words: CaptionWord[];
  /** 一度に画面に表示する単語数（フレーズウィンドウ） */
  phraseWordCount?: number;
}

/**
 * 音声のword timestampに合わせてカラオケ風に単語を強調。
 * 下 1/3 に大きく配置し、受験生がスマホで見ても読める太字ゴシック。
 */
export const KaraokeCaption: React.FC<KaraokeCaptionProps> = ({
  words,
  phraseWordCount = 6,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: videoWidth, height: videoHeight } = useVideoConfig();
  const currentSec = frame / fps;

  const activeIndex = words.findIndex((w) => currentSec >= w.startSec && currentSec < w.endSec);
  if (activeIndex === -1 && currentSec < (words[0]?.startSec ?? Infinity)) {
    return null;
  }

  // アクティブ単語を中心にウィンドウ切り出し
  const centerIndex = activeIndex === -1
    ? words.findIndex((w) => w.startSec > currentSec) - 1
    : activeIndex;
  const start = Math.max(0, centerIndex - Math.floor(phraseWordCount / 2));
  const phrase = words.slice(start, start + phraseWordCount);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: videoHeight * 0.18,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 60px",
        gap: "8px 12px",
        fontFamily,
        fontWeight: 900,
        fontSize: 68,
        lineHeight: 1.3,
        textAlign: "center",
        color: "#ffffff",
        textShadow: "0 4px 12px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.7)",
        WebkitTextStroke: "2px rgba(0,0,0,0.6)",
        width: videoWidth,
      }}
    >
      {phrase.map((w, i) => {
        const isActive = currentSec >= w.startSec && currentSec < w.endSec;
        return (
          <span
            key={start + i}
            style={{
              color: isActive ? "#FFD54F" : "#ffffff",
              transform: isActive ? "scale(1.08)" : "scale(1)",
              transition: "transform 80ms ease-out, color 80ms linear",
              display: "inline-block",
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};
