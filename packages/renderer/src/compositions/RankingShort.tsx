import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Loop,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Scene } from "@rekishi/shared";
import { NarrationAudio } from "../components/NarrationAudio";

// ========================================================================
// 型
// ========================================================================

export interface RankingItem {
  rank: 1 | 2 | 3;
  brand: string;
  category: string;
  productImagePath: string;
  reviews: [string, string, string];
}

export interface RankingOpening {
  // 表示する行。サイズ/色バリアントを行ごとに指定
  lines: Array<{ text: string; variant: "small-white" | "red" | "gold" | "tiny-white" }>;
  // 下部アイコン行。src を指定すれば画像（いらすとや等）、emoji 指定で絵文字プレースホルダ
  icons?: Array<{ src?: string; emoji?: string; size?: number }>;
}

export interface RankingShortProps {
  opening: RankingOpening;
  items: [RankingItem, RankingItem, RankingItem];
  backgroundImagePath: string;
  closing: { text: string };
  totalDurationSec: number;
  /** ナレーション音声（動画全体に流す） */
  audioSrc?: string;
  /** BGM。ループ再生・低音量（デフォルト 0.18） */
  bgmSrc?: string;
  bgmVolume?: number;
  /** ランク登場時の効果音（第3位/第2位/第1位の intro 冒頭に鳴る） */
  rankSfxSrc?: string;
  rankSfxVolume?: number;
  /** オープニングのフック直後に鳴らす SFX（和太鼓 "ドン！" 等） */
  hookSfxSrc?: string;
  hookSfxVolume?: number;
  /**
   * scene-aligner で実音声に合わせて durationSec を上書き済みの Scene 列。
   * 与えられた場合、各シーンの durationSec を順に SceneBlock に流し込みスライド進行を
   * TTS と同期させる。3ピックでは長さ 8 を期待 (opening + intro/review×3 + closing)。
   * 未指定 / 長さ不一致時は固定尺フォールバックで動作（後方互換）。
   */
  scenes?: Scene[];
}

// ========================================================================
// フォント定義
// ========================================================================

const MINCHO_FONT =
  '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", "Noto Serif JP", serif';
const SANS_FONT =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

// ========================================================================
// グラデ + 黒縁 のヘルパー
//
// -webkit-text-stroke は太くするとグラデ塗りが視認できないほど潰れる。
// 同じ位置にテキストを2枚重ねる:
//   下層: 黒ベタ + text-shadow で縁取り
//   上層: background-clip:text でグラデ塗り（縁取りなし）
// ========================================================================

function multiDirectionShadow(width: number, color: string = "#000"): string {
  const offsets: Array<[number, number]> = [];
  // 8方向 + 斜め中間、放射状にカバー
  const step = width;
  for (let dx = -step; dx <= step; dx++) {
    for (let dy = -step; dy <= step; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (Math.abs(dx) === step || Math.abs(dy) === step) {
        offsets.push([dx, dy]);
      }
    }
  }
  return offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`).join(", ");
}

interface StrokedGradientTextProps {
  text: string;
  fontSize: number;
  gradient: string;
  strokeWidth: number;
  fontFamily?: string;
  letterSpacing?: string;
  lineHeight?: number;
  whiteSpace?: React.CSSProperties["whiteSpace"];
  dropShadow?: string;
}

const StrokedGradientText: React.FC<StrokedGradientTextProps> = ({
  text,
  fontSize,
  gradient,
  strokeWidth,
  fontFamily = MINCHO_FONT,
  letterSpacing = "0.02em",
  lineHeight = 1.1,
  whiteSpace,
  dropShadow,
}) => {
  const commonStyle: React.CSSProperties = {
    fontFamily,
    fontWeight: 900,
    fontSize,
    letterSpacing,
    lineHeight,
    whiteSpace,
    margin: 0,
    textAlign: "center",
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* 下層: 黒縁取り（text-shadow による放射状塗り） */}
      <div
        style={{
          ...commonStyle,
          color: "#000",
          textShadow: `${multiDirectionShadow(strokeWidth)}${dropShadow ? `, ${dropShadow}` : ""}`,
        }}
      >
        {text}
      </div>
      {/* 上層: グラデ塗り（縁取りなし、同じ位置に重ねる） */}
      <div
        style={{
          ...commonStyle,
          position: "absolute",
          inset: 0,
          background: gradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          pointerEvents: "none",
        }}
      >
        {text}
      </div>
    </div>
  );
};

interface StrokedSolidTextProps {
  text: string;
  fontSize: number;
  color: string;
  strokeWidth: number;
  fontFamily?: string;
  letterSpacing?: string;
  lineHeight?: number;
  whiteSpace?: React.CSSProperties["whiteSpace"];
  dropShadow?: string;
}

const StrokedSolidText: React.FC<StrokedSolidTextProps> = ({
  text,
  fontSize,
  color,
  strokeWidth,
  fontFamily = MINCHO_FONT,
  letterSpacing = "0.02em",
  lineHeight = 1.1,
  whiteSpace,
  dropShadow,
}) => (
  <div
    style={{
      fontFamily,
      fontWeight: 900,
      fontSize,
      color,
      letterSpacing,
      lineHeight,
      whiteSpace,
      margin: 0,
      textAlign: "center",
      textShadow: `${multiDirectionShadow(strokeWidth)}${dropShadow ? `, ${dropShadow}` : ""}`,
    }}
  >
    {text}
  </div>
);

// ========================================================================
// トランジションラッパー
// ========================================================================

/** シーン冒頭の短いフェードイン（0.15秒） */
const FadeIn: React.FC<{ children: React.ReactNode; durationFrames?: number }> = ({
  children,
  durationFrames = 4,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, durationFrames], [0, 1], {
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** バッジ等の "パンチイン"。スケール1.35→0.95→1.0 でワンバウンド */
const PunchIn: React.FC<{
  children: React.ReactNode;
  durationFrames?: number;
}> = ({ children, durationFrames = 9 }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(
    frame,
    [0, durationFrames * 0.55, durationFrames],
    [1.35, 0.95, 1.0],
    { extrapolateRight: "clamp" },
  );
  const opacity = interpolate(frame, [0, durationFrames * 0.4], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        transform: `scale(${scale})`,
        opacity,
        transformOrigin: "center center",
        display: "inline-block",
      }}
    >
      {children}
    </div>
  );
};

/** ケン・バーンズ風の軽いズームイン（商品カード用） */
const SubtleZoom: React.FC<{
  children: React.ReactNode;
  durationInFrames: number;
  from?: number;
  to?: number;
}> = ({ children, durationInFrames, from = 1.02, to = 1.08 }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        display: "inline-block",
      }}
    >
      {children}
    </div>
  );
};

// ========================================================================
// ブラー背景（共通）
// ========================================================================

const BlurredBackground: React.FC<{ src: string }> = ({ src }) => (
  <AbsoluteFill style={{ backgroundColor: "#0a1420", overflow: "hidden" }}>
    {src ? (
      <Img
        src={src}
        style={{
          width: "120%",
          height: "120%",
          objectFit: "cover",
          position: "absolute",
          top: "-10%",
          left: "-10%",
          filter: "blur(28px) brightness(0.55) saturate(1.1)",
        }}
      />
    ) : (
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 30% 40%, #1d3554 0%, #0a1420 55%, #050a14 100%)",
        }}
      />
    )}
  </AbsoluteFill>
);

// ========================================================================
// 第◯位 バッジ
// ========================================================================

const RankBadge: React.FC<{ rank: number; size?: "large" | "medium" }> = ({
  rank,
  size = "large",
}) => {
  const fontSize = size === "large" ? 260 : 190;
  const strokeWidth = size === "large" ? 10 : 8;
  return (
    <StrokedSolidText
      text={`第${rank}位`}
      fontSize={fontSize}
      color="#ffffff"
      strokeWidth={strokeWidth}
      dropShadow="0 8px 18px rgba(0,0,0,0.85)"
    />
  );
};

// ========================================================================
// 商品カテゴリ/ブランド名 テロップ（自動スケール: 画面幅に応じて1行に収める）
// ========================================================================

const BRAND_BASE_FONT_SIZE = 150;
const BRAND_HORIZONTAL_PADDING = 60;
const JA_CHAR_WIDTH_RATIO = 1.15;
const BRAND_STROKE_WIDTH = 8;

function fitFontSize(
  text: string,
  baseSize: number,
  availableWidth: number,
  strokeWidth: number,
): number {
  if (!text) return baseSize;
  const usable = Math.max(0, availableWidth - strokeWidth * 2);
  const maxByWidth = usable / (text.length * JA_CHAR_WIDTH_RATIO);
  return Math.floor(Math.min(baseSize, maxByWidth));
}

const RED_GRADIENT = "linear-gradient(180deg, #ffcccc 0%, #ff2a2a 40%, #a00000 100%)";
const GOLD_GRADIENT = "linear-gradient(180deg, #fff4b8 0%, #ffcc3a 40%, #b87610 100%)";

const BrandText: React.FC<{ text: string }> = ({ text }) => {
  const { width: videoWidth } = useVideoConfig();
  const availableWidth = videoWidth - BRAND_HORIZONTAL_PADDING * 2;
  const fontSize = fitFontSize(
    text,
    BRAND_BASE_FONT_SIZE,
    availableWidth,
    BRAND_STROKE_WIDTH,
  );
  return (
    <StrokedGradientText
      text={text}
      fontSize={fontSize}
      gradient={RED_GRADIENT}
      strokeWidth={BRAND_STROKE_WIDTH}
      letterSpacing="0.03em"
      whiteSpace="nowrap"
      dropShadow="0 6px 14px rgba(0,0,0,0.85)"
    />
  );
};

// ========================================================================
// 商品画像カード
// ========================================================================

const ProductCard: React.FC<{
  src: string;
  width?: number;
  height?: number;
  faded?: boolean;
}> = ({ src, width = 720, height = 720, faded = false }) => (
  <div
    style={{
      width,
      height,
      backgroundColor: "#ffffff",
      borderRadius: 8,
      overflow: "hidden",
      boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
      opacity: faded ? 0.55 : 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {src ? (
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #e8e8e8 0%, #bdbdbd 50%, #9e9e9e 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
          fontFamily: SANS_FONT,
          fontSize: 40,
          fontWeight: 700,
        }}
      >
        商品画像
      </div>
    )}
  </div>
);

// ========================================================================
// レビュー吹き出し
// ========================================================================

const REVIEW_COLORS: Array<{ border: string }> = [
  { border: "#ff5a80" },
  { border: "#5bd37a" },
  { border: "#7f5bf0" },
];

const ReviewBubble: React.FC<{ text: string; colorIndex: number }> = ({
  text,
  colorIndex,
}) => {
  const { border } = REVIEW_COLORS[colorIndex] ?? REVIEW_COLORS[0]!;
  return (
    <div
      style={{
        backgroundColor: "#ffffff",
        border: `8px solid ${border}`,
        borderRadius: 4,
        padding: "24px 32px",
        fontFamily: SANS_FONT,
        fontWeight: 900,
        fontSize: 54,
        color: "#111",
        lineHeight: 1.25,
        letterSpacing: "0.01em",
        textAlign: "left",
        boxShadow: "0 8px 18px rgba(0,0,0,0.35)",
        width: 880,
        wordBreak: "keep-all",
        overflowWrap: "anywhere",
      }}
    >
      {text}
    </div>
  );
};

// ========================================================================
// シーン: オープニング
// ========================================================================

const OpeningScene: React.FC<{ opening: RankingOpening }> = ({ opening }) => {
  const frame = useCurrentFrame();
  const introProgress = interpolate(frame, [0, 5], [0, 1], {
    extrapolateRight: "clamp",
  });
  const renderLine = (
    line: RankingOpening["lines"][number],
    idx: number,
  ): React.ReactNode => {
    switch (line.variant) {
      case "small-white":
        return (
          <StrokedSolidText
            key={idx}
            text={line.text}
            fontSize={110}
            color="#ffffff"
            strokeWidth={6}
            dropShadow="0 4px 12px rgba(0,0,0,0.9)"
          />
        );
      case "red":
        return (
          <StrokedGradientText
            key={idx}
            text={line.text}
            fontSize={190}
            gradient={RED_GRADIENT}
            strokeWidth={8}
            dropShadow="0 6px 14px rgba(0,0,0,0.85)"
          />
        );
      case "gold":
        return (
          <StrokedGradientText
            key={idx}
            text={line.text}
            fontSize={160}
            gradient={GOLD_GRADIENT}
            strokeWidth={8}
            dropShadow="0 6px 14px rgba(0,0,0,0.85)"
          />
        );
      case "tiny-white":
        return (
          <StrokedSolidText
            key={idx}
            text={line.text}
            fontSize={70}
            color="#ffffff"
            strokeWidth={4}
          />
        );
      default:
        return null;
    }
  };

  return (
    <AbsoluteFill style={{ opacity: introProgress }}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: 120,
          gap: 14,
        }}
      >
        {opening.lines.map(renderLine)}
      </AbsoluteFill>
      {opening.icons && opening.icons.length > 0 && (
        <OpeningIconRow icons={opening.icons} />
      )}
    </AbsoluteFill>
  );
};

const OpeningIconRow: React.FC<{ icons: NonNullable<RankingOpening["icons"]> }> = ({
  icons,
}) => (
  <div
    style={{
      position: "absolute",
      bottom: 80,
      left: 0,
      right: 0,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      gap: 12,
      padding: "0 40px",
    }}
  >
    {icons.map((icon, idx) => {
      const size = icon.size ?? 240;
      if (icon.src) {
        return (
          <Img
            key={idx}
            src={icon.src}
            style={{
              width: size,
              height: size,
              objectFit: "contain",
            }}
          />
        );
      }
      if (icon.emoji) {
        return (
          <div
            key={idx}
            style={{
              fontSize: size * 0.9,
              lineHeight: 1,
              filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.6))",
            }}
          >
            {icon.emoji}
          </div>
        );
      }
      return null;
    })}
  </div>
);

// ========================================================================
// シーン: ランク 商品紹介
// ========================================================================

const RankIntroScene: React.FC<{
  item: RankingItem;
  durationInFrames: number;
}> = ({ item, durationInFrames }) => (
  <FadeIn>
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 140,
        gap: 60,
      }}
    >
      <PunchIn>
        <RankBadge rank={item.rank} size="large" />
      </PunchIn>
      <BrandText text={item.category} />
      <SubtleZoom durationInFrames={durationInFrames}>
        <ProductCard src={item.productImagePath} width={720} height={720} />
      </SubtleZoom>
    </AbsoluteFill>
  </FadeIn>
);

// ========================================================================
// シーン: ランク レビュー
// ========================================================================

const RankReviewScene: React.FC<{
  item: RankingItem;
  durationInFrames: number;
}> = ({ item, durationInFrames }) => {
  // レビュー3枚をシーン時間に沿って順次表示する。
  // ナレーション（TTS）が各レビューを順に読み上げるペースにざっくり合わせるため、
  // 冒頭のフェードイン分だけ詰めた残り時間を3等分し、等間隔で登場させる。
  const leadFrames = 4;
  const usable = Math.max(1, durationInFrames - leadFrames);
  const slot = usable / item.reviews.length;

  return (
    <FadeIn>
      {/* 背景レイヤー: 第◯位 + 商品画像（intro と同じ位置・サイズ） */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: 140,
          gap: 60,
        }}
      >
        <RankBadge rank={item.rank} size="large" />
        {/* intro の BrandText 位置を空白で埋める（スペースキープ） */}
        <div style={{ height: 165 }} />
        <ProductCard src={item.productImagePath} width={720} height={720} faded />
      </AbsoluteFill>
      {/* 前景レイヤー: レビュー吹き出し 3枚、商品画像にオーバーレイ。順番に pop-in */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          paddingTop: 380,
          gap: 26,
          zIndex: 2,
        }}
      >
        {item.reviews.map((text, i) => (
          <StaggeredAppear key={i} delayFrames={Math.round(leadFrames + slot * i)}>
            <ReviewBubble text={text} colorIndex={i} />
          </StaggeredAppear>
        ))}
      </AbsoluteFill>
    </FadeIn>
  );
};

/** 指定フレーム遅延後にフェード+軽くスライドアップして登場 */
const StaggeredAppear: React.FC<{
  children: React.ReactNode;
  delayFrames: number;
  fadeDurationFrames?: number;
}> = ({ children, delayFrames, fadeDurationFrames = 6 }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [delayFrames, delayFrames + fadeDurationFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const translateY = (1 - progress) * 24;
  return (
    <div
      style={{
        opacity: progress,
        transform: `translateY(${translateY}px)`,
      }}
    >
      {children}
    </div>
  );
};

// ========================================================================
// シーン: 締め
// ========================================================================

const ClosingScene: React.FC<{ text: string }> = ({ text }) => (
  <FadeIn>
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: 60,
      }}
    >
      <StrokedSolidText
        text={text}
        fontSize={140}
        color="#ffffff"
        strokeWidth={8}
        lineHeight={1.2}
        dropShadow="0 6px 18px rgba(0,0,0,0.9)"
      />
    </AbsoluteFill>
  </FadeIn>
);

// ========================================================================
// 全体 composition
// ========================================================================

type SceneBlock =
  | { kind: "opening" }
  | { kind: "rank-intro"; item: RankingItem }
  | { kind: "rank-review"; item: RankingItem }
  | { kind: "closing" };

/**
 * scene index から SceneBlock の kind と対応 rank を導く。
 * 期待するレイアウト (itemCount=3): [opening, r3-intro, r3-review, r2-intro, r2-review, r1-intro, r1-review, closing]
 *   length = itemCount * 2 + 2
 * - i === 0           → opening
 * - i === length-1    → closing
 * - 中間: 偶数 index → rank-intro / 奇数 index → rank-review
 *   対応 rank = itemCount - floor((i - 1) / 2)
 *
 * 範囲外なら null を返す（呼び出し側で固定尺フォールバック）。
 */
function blockKindForIndex(
  i: number,
  itemCount: number,
):
  | { kind: "opening" }
  | { kind: "closing" }
  | { kind: "rank-intro"; rank: number }
  | { kind: "rank-review"; rank: number }
  | null {
  const expectedLength = itemCount * 2 + 2;
  if (i < 0 || i >= expectedLength) return null;
  if (i === 0) return { kind: "opening" };
  if (i === expectedLength - 1) return { kind: "closing" };
  const middleIdx = i - 1;
  const rank = itemCount - Math.floor(middleIdx / 2);
  if (rank < 1 || rank > itemCount) return null;
  if (middleIdx % 2 === 0) return { kind: "rank-intro", rank };
  return { kind: "rank-review", rank };
}

/**
 * scenes が与えられている場合は実発話の durationSec で SceneBlock を組み立てる。
 * 失敗（scenes 未指定 / 長さ不一致 / kind 解決不能 / rank 不在）した場合は null を返し、
 * 呼び出し側で固定尺フォールバックを使う。
 */
function buildSceneBlocksFromScenes(
  items: [RankingItem, RankingItem, RankingItem],
  scenes: Scene[],
): Array<SceneBlock & { durationSec: number }> | null {
  const expectedLength = items.length * 2 + 2;
  if (scenes.length !== expectedLength) return null;

  const blocks: Array<SceneBlock & { durationSec: number }> = [];
  for (let i = 0; i < scenes.length; i++) {
    const meta = blockKindForIndex(i, items.length);
    if (!meta) return null;
    const durationSec = scenes[i]!.durationSec;
    if (meta.kind === "opening") {
      blocks.push({ kind: "opening", durationSec });
    } else if (meta.kind === "closing") {
      blocks.push({ kind: "closing", durationSec });
    } else {
      const item = items.find((it) => it.rank === meta.rank);
      if (!item) return null;
      blocks.push({ kind: meta.kind, item, durationSec });
    }
  }
  return blocks;
}

function buildSceneBlocksFixed(
  items: [RankingItem, RankingItem, RankingItem],
): Array<SceneBlock & { durationSec: number }> {
  const blocks: Array<SceneBlock & { durationSec: number }> = [];
  blocks.push({ kind: "opening", durationSec: 3.0 });

  const byRank = (r: 1 | 2 | 3) => items.find((it) => it.rank === r)!;

  // 3位 → 2位 → 1位 の順で intro + review
  [3, 2, 1].forEach((r, idx) => {
    const item = byRank(r as 1 | 2 | 3);
    const introSec = r === 1 ? 4.0 : 3.5;
    const reviewSec = r === 1 ? 5.0 : 4.0;
    blocks.push({ kind: "rank-intro", item, durationSec: introSec });
    blocks.push({ kind: "rank-review", item, durationSec: reviewSec });
    void idx;
  });

  blocks.push({ kind: "closing", durationSec: 2.5 });
  return blocks;
}

function buildSceneBlocks(
  items: [RankingItem, RankingItem, RankingItem],
  scenes?: Scene[],
): Array<SceneBlock & { durationSec: number }> {
  if (scenes && scenes.length > 0) {
    const fromScenes = buildSceneBlocksFromScenes(items, scenes);
    if (fromScenes) return fromScenes;
    // 不整合時は固定尺で出してログを残す（コンポは Remotion 内で動くので console.warn）
    // eslint-disable-next-line no-console
    console.warn(
      `[RankingShort] scenes length=${scenes.length} did not match expected ${items.length * 2 + 2}. Falling back to fixed durations.`,
    );
  }
  return buildSceneBlocksFixed(items);
}

export const RankingShort: React.FC<RankingShortProps> = ({
  opening,
  items,
  backgroundImagePath,
  closing,
  audioSrc,
  bgmSrc,
  bgmVolume = 0.18,
  rankSfxSrc,
  rankSfxVolume = 0.7,
  hookSfxSrc,
  hookSfxVolume = 0.8,
  scenes,
}) => {
  const { fps } = useVideoConfig();
  const blocks = buildSceneBlocks(items, scenes);

  let cursor = 0;
  const layout = blocks.map((block) => {
    const startFrame = Math.round(cursor * fps);
    const durationFrames = Math.max(1, Math.round(block.durationSec * fps));
    cursor += block.durationSec;
    return { block, startFrame, durationFrames };
  });

  // hookSfx は opening 冒頭で鳴らす
  const hookSfxStart = 0;
  // rankSfx は各 rank-intro の冒頭で鳴らす
  const rankIntroStarts = layout
    .filter((l) => l.block.kind === "rank-intro")
    .map((l) => l.startFrame);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <BlurredBackground src={backgroundImagePath} />
      {layout.map(({ block, startFrame, durationFrames }, idx) => (
        <Sequence key={idx} from={startFrame} durationInFrames={durationFrames}>
          {block.kind === "opening" ? (
            <OpeningScene opening={opening} />
          ) : block.kind === "rank-intro" ? (
            <RankIntroScene
              item={block.item}
              durationInFrames={durationFrames}
            />
          ) : block.kind === "rank-review" ? (
            <RankReviewScene
              item={block.item}
              durationInFrames={durationFrames}
            />
          ) : (
            <ClosingScene text={closing.text} />
          )}
        </Sequence>
      ))}

      {/* 音声レイヤー */}
      {audioSrc && <NarrationAudio src={audioSrc} />}
      {bgmSrc && (
        <Loop durationInFrames={fps * 60}>
          <Audio src={bgmSrc} volume={bgmVolume} />
        </Loop>
      )}
      {hookSfxSrc && (
        <Sequence from={hookSfxStart}>
          <Audio src={hookSfxSrc} volume={hookSfxVolume} />
        </Sequence>
      )}
      {rankSfxSrc &&
        rankIntroStarts.map((startFrame, i) => (
          <Sequence key={`rank-sfx-${i}`} from={startFrame}>
            <Audio src={rankSfxSrc} volume={rankSfxVolume} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
};
