import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { loadDefaultJapaneseParser } from "budoux";
import type { CaptionSegment } from "@rekishi/shared";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

const parser = loadDefaultJapaneseParser();

export interface LongformCaptionProps {
  captionSegments: CaptionSegment[];
}

/**
 * 16:9 長尺向けの控えめな下部テロップ。
 * - 画面下端から 8% 上の位置に固定
 * - 黒い半透明帯 + 白テキスト + 影
 * - budoux で日本語の改行候補を入れ、なるべく自然な位置で折り返す
 */
export const LongformCaption: React.FC<LongformCaptionProps> = ({
  captionSegments,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  const active = captionSegments.find(
    (c) => currentSec >= c.startSec && currentSec < c.endSec,
  );
  if (!active) return null;

  const text = active.text.trim();
  if (!text) return null;

  const breaks = new Set(parser.parseBoundaries(text));
  const nodes: React.ReactNode[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    if (breaks.has(i + 1) && i + 1 < text.length) {
      nodes.push(<React.Fragment key={`s-${i}`}>{buf}</React.Fragment>);
      nodes.push(<wbr key={`w-${i}`} />);
      buf = "";
    }
  }
  if (buf) nodes.push(<React.Fragment key="tail">{buf}</React.Fragment>);

  return (
    <div
      style={{
        position: "absolute",
        bottom: "8%",
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
          maxWidth: "82%",
          textAlign: "center",
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 56,
          color: "#FFFFFF",
          background: "rgba(0, 0, 0, 0.55)",
          padding: "16px 32px",
          borderRadius: 8,
          textShadow: "0 0 8px #000, 0 0 4px #000",
          lineHeight: 1.35,
          wordBreak: "keep-all",
          overflowWrap: "anywhere",
        }}
      >
        {nodes}
      </div>
    </div>
  );
};
