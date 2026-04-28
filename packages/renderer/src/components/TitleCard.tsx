import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export type TitleCardKind =
  | "method-1"
  | "method-2"
  | "spirit-vs-science";

export interface TitleCardProps {
  kind: TitleCardKind;
  /** Method N の名前 (例: "想起練習" / "分散学習")。kind="method-N" 時のみ使用 */
  methodName?: string;
}

const PINK_BG = "linear-gradient(135deg, #E91E63 0%, #FF6FA0 100%)";
const PINK_BG_ALT = "linear-gradient(135deg, #C2185B 0%, #E91E63 100%)";

/**
 * Bro Pump 構造の "METHOD N" タイトルカード、および
 * "精神論 ✕ → 認知科学 ◯" の対比カード。
 * 全カードはピンク系の単色背景＋白タイポで brand 一貫性を保つ。
 */
export const TitleCard: React.FC<TitleCardProps> = ({ kind, methodName }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 入りはバウンス気味のスケールイン (0 → 1.05 → 1.0)
  const scaleIn = spring({ frame, fps, config: { damping: 12, stiffness: 180 } });
  const scale = interpolate(scaleIn, [0, 1], [0.6, 1]);
  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });

  if (kind === "spirit-vs-science") {
    return (
      <AbsoluteFill style={{ background: PINK_BG_ALT, opacity }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT_FAMILY,
            color: "#fff",
            transform: `scale(${scale})`,
          }}
        >
          <div style={{ fontSize: 110, fontWeight: 900, lineHeight: 1.15, marginBottom: 60 }}>
            <span style={{ opacity: 0.55, textDecoration: "line-through" }}>精神論</span>
            <span style={{ marginLeft: 32, fontSize: 130 }}>✕</span>
          </div>
          <div style={{ fontSize: 90, fontWeight: 700, opacity: 0.95, marginBottom: 60 }}>↓</div>
          <div style={{ fontSize: 130, fontWeight: 900, lineHeight: 1.15 }}>
            <span>認知科学</span>
            <span style={{ marginLeft: 32, fontSize: 150, color: "#FFEB3B" }}>◯</span>
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  const number = kind === "method-1" ? "1" : "2";

  return (
    <AbsoluteFill style={{ background: PINK_BG, opacity }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT_FAMILY,
          color: "#fff",
          transform: `scale(${scale})`,
        }}
      >
        <div
          style={{
            fontSize: 80,
            fontWeight: 900,
            letterSpacing: "0.18em",
            opacity: 0.88,
            marginBottom: 20,
          }}
        >
          METHOD
        </div>
        <div
          style={{
            fontSize: 540,
            fontWeight: 900,
            lineHeight: 1,
            textShadow: "0 12px 0 rgba(0,0,0,0.18)",
            marginBottom: 20,
          }}
        >
          {number}
        </div>
        {methodName && (
          <div
            style={{
              fontSize: 130,
              fontWeight: 900,
              letterSpacing: "0.04em",
              borderTop: "8px solid #fff",
              paddingTop: 36,
              marginTop: 12,
            }}
          >
            {methodName}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
