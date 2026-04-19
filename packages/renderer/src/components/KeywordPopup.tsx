import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";

const { fontFamily } = loadFont();

export interface KeywordHit {
  term: string;
  startSec: number;
  endSec: number;
}

export interface KeywordPopupProps {
  hits: KeywordHit[];
}

/**
 * 台本中の重要用語（年号・人名・地名など）が話されたタイミングで
 * 画面上部に大きくポップアップ表示する。
 */
/** 発話区間が短くても最低これだけは表示し続ける秒数（ショート視聴者の可読性優先） */
const MIN_POPUP_DURATION_SEC = 2.0;
const FADE_OUT_SEC = 0.3;

export const KeywordPopup: React.FC<KeywordPopupProps> = ({ hits }) => {
  const frame = useCurrentFrame();
  const { fps, height: videoHeight } = useVideoConfig();
  const currentSec = frame / fps;

  const active = hits.find((h) => {
    const displayEnd = Math.max(h.endSec, h.startSec + MIN_POPUP_DURATION_SEC);
    return currentSec >= h.startSec && currentSec < displayEnd + FADE_OUT_SEC;
  });
  if (!active) return null;

  const displayEnd = Math.max(active.endSec, active.startSec + MIN_POPUP_DURATION_SEC);
  const localFrame = frame - Math.round(active.startSec * fps);
  const popScale = spring({ frame: localFrame, fps, config: { damping: 12, stiffness: 200 } });
  const fadeOut = interpolate(
    currentSec,
    [displayEnd, displayEnd + FADE_OUT_SEC],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: videoHeight * 0.18,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        opacity: fadeOut,
        transform: `scale(${popScale})`,
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: 96,
          color: "#FFD54F",
          background: "rgba(0,0,0,0.75)",
          padding: "18px 36px",
          borderRadius: 22,
          border: "4px solid #FFD54F",
          textShadow: "0 0 18px rgba(255,213,79,0.6)",
          boxShadow: "0 12px 36px rgba(0,0,0,0.7)",
        }}
      >
        {active.term}
      </div>
    </div>
  );
};
