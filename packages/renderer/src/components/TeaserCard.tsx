import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export interface TeaserCardProps {
  text: string;
  /** Seconds the card stays fully visible before fading out. */
  holdSec?: number;
  /** Seconds of fade-out after hold. */
  fadeSec?: number;
}

const DEFAULT_HOLD_SEC = 2.7;
const DEFAULT_FADE_SEC = 0.3;

export const TeaserCard: React.FC<TeaserCardProps> = ({
  text,
  holdSec = DEFAULT_HOLD_SEC,
  fadeSec = DEFAULT_FADE_SEC,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;
  const totalSec = holdSec + fadeSec;

  if (!text || currentSec >= totalSec) return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  const popScale = spring({ frame, fps, config: { damping: 14, stiffness: 220 } });
  const opacity = interpolate(currentSec, [holdSec, totalSec], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 12字以内想定だが、長文が来たときも事故らないように文字数でサイズを自動調整
  const fontSize = trimmed.length <= 8 ? 160 : trimmed.length <= 12 ? 132 : 104;

  return (
    <div
      style={{
        position: "absolute",
        top: "12%",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 20,
        opacity,
      }}
    >
      <div
        style={{
          transform: `scale(${popScale})`,
          maxWidth: "92%",
          textAlign: "center",
          fontFamily: FONT_FAMILY,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.15,
          color: "#FFEB3B",
          WebkitTextStroke: "6px #000",
          textShadow:
            "0 0 14px rgba(0,0,0,0.9), 0 4px 18px rgba(0,0,0,0.8), 0 0 6px #000",
          letterSpacing: "0.02em",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          padding: "24px 40px",
          background: "rgba(0,0,0,0.35)",
          borderRadius: 24,
        }}
      >
        {trimmed}
      </div>
    </div>
  );
};
