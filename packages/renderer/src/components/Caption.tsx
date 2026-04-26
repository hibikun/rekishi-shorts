import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { loadDefaultJapaneseParser } from "budoux";
import { loadFont as loadShipporiMincho } from "@remotion/google-fonts/ShipporiMincho";
import type { CaptionSegment } from "@rekishi/shared";

const DEFAULT_FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

const { fontFamily: shipporiMinchoFamily } = loadShipporiMincho("normal", {
  weights: ["700", "800"],
  ignoreTooManyRequestsWarning: true,
});

const UKIYOE_FONT_FAMILY = `"${shipporiMinchoFamily}", "Hiragino Mincho ProN", "YuMincho", serif`;

const KEY_TERM_COLOR = "#FFD54F";
const TEXT_COLOR = "#FFFFFF";

const parser = loadDefaultJapaneseParser();

export type CaptionVariant = "default" | "ukiyoe";

export interface CaptionProps {
  captionSegments: CaptionSegment[];
  keyTerms?: string[];
  variant?: CaptionVariant;
}

export const Caption: React.FC<CaptionProps> = ({
  captionSegments,
  keyTerms = [],
  variant = "default",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  const active = captionSegments.find(
    (c) => currentSec >= c.startSec && currentSec < c.endSec,
  );

  const text = active?.text.trim() ?? "";
  const keyTermsKey = keyTerms.join("|");

  const elements = React.useMemo(
    () => (text.length === 0 ? [] : buildElements(text, keyTerms)),
    [text, keyTermsKey],
  );

  if (!active || elements.length === 0) return null;

  const isUkiyoe = variant === "ukiyoe";

  const innerStyle: React.CSSProperties = isUkiyoe
    ? {
        maxWidth: "88%",
        textAlign: "center",
        fontFamily: UKIYOE_FONT_FAMILY,
        fontWeight: 800,
        fontSize: 68,
        color: TEXT_COLOR,
        background: "transparent",
        padding: "8px 20px",
        textShadow:
          "0 0 14px #000, 0 0 10px #000, 0 0 6px #000, 0 2px 4px rgba(0,0,0,0.9)",
        WebkitTextStroke: "2px rgba(0,0,0,0.9)",
        letterSpacing: "0.04em",
        lineHeight: 1.25,
        wordBreak: "keep-all",
        overflowWrap: "anywhere",
      }
    : {
        maxWidth: "88%",
        textAlign: "center",
        fontFamily: DEFAULT_FONT_FAMILY,
        fontWeight: 700,
        fontSize: 64,
        color: TEXT_COLOR,
        background: "rgba(0,0,0,0.5)",
        padding: "16px 28px",
        textShadow: "0 0 10px #000, 0 0 6px #000, 0 0 4px #000",
        lineHeight: 1.2,
        wordBreak: "keep-all",
        overflowWrap: "anywhere",
      };

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
      <div style={innerStyle}>{elements}</div>
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

function buildElements(text: string, keyTerms: string[]): React.ReactNode[] {
  const parts = highlightKeyTerms(text, keyTerms);
  const breakOffsets = new Set(parser.parseBoundaries(text));

  const nodes: React.ReactNode[] = [];
  let offset = 0;
  let keyIdx = 0;

  for (const part of parts) {
    let buf = "";
    for (const ch of part.text) {
      buf += ch;
      offset += ch.length;
      if (breakOffsets.has(offset) && offset < text.length) {
        nodes.push(renderChunk(buf, part.isKeyTerm, keyIdx++));
        nodes.push(<wbr key={`wbr-${keyIdx++}`} />);
        buf = "";
      }
    }
    if (buf.length > 0) {
      nodes.push(renderChunk(buf, part.isKeyTerm, keyIdx++));
    }
  }

  return nodes;
}

function renderChunk(text: string, isKeyTerm: boolean, key: number): React.ReactNode {
  if (isKeyTerm) {
    return (
      <span key={`kt-${key}`} style={{ color: KEY_TERM_COLOR }}>
        {text}
      </span>
    );
  }
  return <React.Fragment key={`t-${key}`}>{text}</React.Fragment>;
}
