import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionSegment } from "@rekishi/shared";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

const KEY_TERM_COLOR = "#FFD54F";
const TEXT_COLOR = "#FFFFFF";

export interface CaptionProps {
  captionSegments: CaptionSegment[];
  keyTerms?: string[];
}

export const Caption: React.FC<CaptionProps> = ({ captionSegments, keyTerms = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  const active = captionSegments.find(
    (c) => currentSec >= c.startSec && currentSec < c.endSec,
  );
  if (!active) return null;

  const text = active.text.trim();
  if (text.length === 0) return null;

  const parts = highlightKeyTerms(text, keyTerms);

  return (
    <div
      style={{
        position: "absolute",
        bottom: "38%",
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
          color: TEXT_COLOR,
          background: "rgba(0,0,0,0.5)",
          padding: "16px 28px",
          textShadow: "0 0 10px #000, 0 0 6px #000, 0 0 4px #000",
          lineHeight: 1.2,
          wordBreak: "break-word",
          overflowWrap: "anywhere",
        }}
      >
        {parts.map((part, i) =>
          part.isKeyTerm ? (
            <span key={i} style={{ color: KEY_TERM_COLOR }}>
              {part.text}
            </span>
          ) : (
            <React.Fragment key={i}>{part.text}</React.Fragment>
          ),
        )}
      </div>
    </div>
  );
};

interface TextPart {
  text: string;
  isKeyTerm: boolean;
}

function highlightKeyTerms(text: string, keyTerms: string[]): TextPart[] {
  const terms = keyTerms
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) return [{ text, isKeyTerm: false }];

  const parts: TextPart[] = [];
  let i = 0;
  while (i < text.length) {
    let matched: string | null = null;
    for (const term of terms) {
      if (text.startsWith(term, i)) {
        matched = term;
        break;
      }
    }
    if (matched) {
      parts.push({ text: matched, isKeyTerm: true });
      i += matched.length;
    } else {
      const last = parts[parts.length - 1];
      if (last && !last.isKeyTerm) {
        last.text += text[i];
      } else {
        parts.push({ text: text[i]!, isKeyTerm: false });
      }
      i += 1;
    }
  }
  return parts;
}
