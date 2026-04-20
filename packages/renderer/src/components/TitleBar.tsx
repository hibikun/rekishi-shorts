import React from "react";
import { useVideoConfig } from "remotion";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export interface TitleBarProps {
  top: string;
  bottom: string;
}

const BAR_HEIGHT_RATIO = 0.25;
const HORIZONTAL_PADDING = 30;
const YELLOW = "#FFEB3B";
const RED = "#E53935";

// 日本語は正方形に近いが、縁取り太さ分の余白を持たせるため保守的な係数を使う
const JA_CHAR_WIDTH_RATIO = 1.02;
const TOP_BASE_FONT_SIZE = 95;
const BOTTOM_BASE_FONT_SIZE = 140;

function fitFontSize(text: string, baseSize: number, availableWidth: number): number {
  if (!text) return baseSize;
  const maxByWidth = availableWidth / (text.length * JA_CHAR_WIDTH_RATIO);
  return Math.floor(Math.min(baseSize, maxByWidth));
}

export const TitleBar: React.FC<TitleBarProps> = ({ top, bottom }) => {
  const { width: videoWidth } = useVideoConfig();

  const topText = top?.trim() ?? "";
  const bottomText = bottom?.trim() ?? "";
  if (!topText && !bottomText) return null;

  const availableWidth = videoWidth - HORIZONTAL_PADDING * 2;
  const topFontSize = fitFontSize(topText, TOP_BASE_FONT_SIZE, availableWidth);
  const bottomFontSize = fitFontSize(bottomText, BOTTOM_BASE_FONT_SIZE, availableWidth);

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
        padding: `0 ${HORIZONTAL_PADDING}px`,
      }}
    >
      {topText && (
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontWeight: 900,
            fontSize: topFontSize,
            lineHeight: 1.1,
            color: YELLOW,
            WebkitTextStroke: "6px #000",
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
            color: RED,
            WebkitTextStroke: "8px #000",
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
