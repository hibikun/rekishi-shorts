import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export interface TitleBarProps {
  top: string;
  bottom: string;
}

const BAR_HEIGHT_RATIO = 0.25;
const YELLOW = "#FFEB3B";
const RED = "#E53935";

export const TitleBar: React.FC<TitleBarProps> = ({ top, bottom }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const topText = top?.trim() ?? "";
  const bottomText = bottom?.trim() ?? "";
  if (!topText && !bottomText) return null;

  const popScale = spring({ frame, fps, config: { damping: 16, stiffness: 200 } });

  const topFontSize = topText.length <= 10 ? 90 : 76;
  const bottomFontSize = bottomText.length <= 10 ? 130 : bottomText.length <= 13 ? 112 : 96;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: `${BAR_HEIGHT_RATIO * 100}%`,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 30,
        pointerEvents: "none",
        gap: 24,
        padding: "0 48px",
        transform: `scale(${popScale})`,
        transformOrigin: "center center",
      }}
    >
      {topText && (
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontWeight: 900,
            fontSize: topFontSize,
            lineHeight: 1.1,
            color: "#FFFFFF",
            WebkitTextStroke: `8px ${YELLOW}`,
            paintOrder: "stroke fill",
            textShadow: "0 0 10px rgba(0,0,0,0.9), 0 4px 14px rgba(0,0,0,0.8)",
            letterSpacing: "0.02em",
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {topText}
        </div>
      )}
      {bottomText && (
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontWeight: 900,
            fontSize: bottomFontSize,
            lineHeight: 1.1,
            color: "#FFFFFF",
            WebkitTextStroke: `10px ${RED}`,
            paintOrder: "stroke fill",
            textShadow: "0 0 12px rgba(0,0,0,0.9), 0 4px 18px rgba(0,0,0,0.85)",
            letterSpacing: "0.02em",
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {bottomText}
        </div>
      )}
    </div>
  );
};
