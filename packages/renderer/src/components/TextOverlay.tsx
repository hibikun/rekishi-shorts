import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export type TextOverlayPosition = "top" | "center" | "bottom";
export type TextOverlayColor = "red" | "white" | "yellow" | "pink";

export interface TextOverlayProps {
  text: string;
  /** どこに置くか。default: "top" */
  position?: TextOverlayPosition;
  /** 色テーマ。default: "red" (HOOK 用) */
  color?: TextOverlayColor;
  /** デフォルト 220px。短いインパクト系は大きめ、長文は小さめに */
  fontSize?: number;
  /** 入りタイミングを少し遅らせたい場合のフレーム遅延 */
  delayFrames?: number;
}

const COLOR_MAP: Record<TextOverlayColor, { fill: string; stroke: string }> = {
  red: { fill: "#FF1744", stroke: "#fff" },
  white: { fill: "#fff", stroke: "#222" },
  yellow: { fill: "#FFEB3B", stroke: "#222" },
  pink: { fill: "#FF6FA0", stroke: "#fff" },
};

/**
 * 画像/カードの上に重ねる強烈なテキスト（"STOP" / "時間の無駄" / "2倍以上" など）。
 * 入りはバウンスで「ドン!」と出す。
 */
export const TextOverlay: React.FC<TextOverlayProps> = ({
  text,
  position = "top",
  color = "red",
  fontSize = 220,
  delayFrames = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - delayFrames);

  const punch = spring({ frame: localFrame, fps, config: { damping: 8, stiffness: 220, mass: 0.6 } });
  const scale = interpolate(punch, [0, 1], [0.2, 1]);
  const opacity = interpolate(localFrame, [0, 6], [0, 1], { extrapolateRight: "clamp" });

  const palette = COLOR_MAP[color];

  const positionStyle: React.CSSProperties =
    position === "top"
      ? { top: "8%", display: "flex", justifyContent: "center" }
      : position === "bottom"
        ? { bottom: "12%", display: "flex", justifyContent: "center" }
        : { top: "50%", transform: "translateY(-50%)", display: "flex", justifyContent: "center" };

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...positionStyle,
        opacity,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          fontFamily: FONT_FAMILY,
          fontSize,
          fontWeight: 900,
          color: palette.fill,
          // ストロークで読みやすく（背景が混雑しても抜ける）
          WebkitTextStroke: `12px ${palette.stroke}`,
          paintOrder: "stroke fill",
          textShadow: "0 16px 0 rgba(0,0,0,0.18)",
          letterSpacing: "0.02em",
          transform: `scale(${scale})`,
          display: "inline-block",
          padding: "0 32px",
          textAlign: "center",
        }}
      >
        {text}
      </span>
    </div>
  );
};
