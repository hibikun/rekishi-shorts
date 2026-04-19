import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionSegment } from "@rekishi/shared";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export interface CaptionProps {
  captionSegments: CaptionSegment[];
}

export const Caption: React.FC<CaptionProps> = ({ captionSegments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  const active = captionSegments.find(
    (c) => currentSec >= c.startSec && currentSec < c.endSec,
  );
  if (!active) return null;

  const text = active.text.trim();
  if (text.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: "18%",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <div
        style={{
          maxWidth: "88%",
          textAlign: "center",
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 64,
          color: "#FFFFFF",
          textShadow: "0 0 10px #000, 0 0 6px #000, 0 0 4px #000",
          lineHeight: 1.2,
          wordBreak: "break-word",
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </div>
    </div>
  );
};
