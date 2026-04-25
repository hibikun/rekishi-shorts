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
import type { AudioClip, Scene } from "@rekishi/shared";
import { NarrationAudio } from "../components/NarrationAudio";

// ============================================================================
// 公開型 (RankingPlanSchema 互換)
// ============================================================================

export interface RankingItem {
  rank: 1 | 2 | 3;
  brand: string;
  category: string;
  productImagePath: string;
  reviews: [string, string, string];
}

export interface RankingOpening {
  /**
   * 表示する行。variant ごとに階層 (フォントサイズ/色/ウェイト) を切り替える。
   * rg-A balanced ベースのデザインでは派手なグラデを廃し、明朝アイボリーに統一。
   * variant 名は既存スキーマ後方互換のため small-white / red / gold / tiny-white を維持。
   */
  lines: Array<{ text: string; variant: "small-white" | "red" | "gold" | "tiny-white" }>;
  /**
   * 既存スキーマ互換のため受け取るが、rg-A デザインではローズゴールドの装飾モチーフを優先するため
   * このアイコン行は描画しない (後方互換)。
   */
  icons?: Array<{ src?: string; emoji?: string; size?: number }>;
}

export interface RankingShortProps {
  opening: RankingOpening;
  items: [RankingItem, RankingItem, RankingItem];
  backgroundImagePath: string;
  closing: { text: string };
  totalDurationSec: number;
  audioSrc?: string;
  bgmSrc?: string;
  bgmVolume?: number;
  rankSfxSrc?: string;
  rankSfxVolume?: number;
  hookSfxSrc?: string;
  hookSfxVolume?: number;
  /**
   * scene-aligner で実音声に合わせて durationSec を上書き済みの Scene 列。
   * 3ピックでは長さ 8 を期待 (opening + intro/review×3 + closing)。
   * 未指定 / 長さ不一致時は固定尺フォールバック。
   */
  scenes?: Scene[];
  /**
   * セグメント別 TTS の audioClips マニフェスト (案G改)。
   * レビュー吹き出しの登場フレームを各 review クリップの startSec に同期する。
   */
  audioClips?: AudioClip[];
}

// ============================================================================
// デザイントークン (rg-A balanced: matte black + rose gold + ivory mincho)
// ============================================================================

const COLORS = {
  bgBase: "#0a0908",
  bgMarbleHi: "#1c1715",
  bgMarbleLo: "#040303",
  ivory: "#ece1c8",
  ivoryBright: "#f6ecd6",
  ivoryDim: "#a8987a",
  rosegold: "#c9a36a",
  rosegoldSoft: "#8a6f48",
} as const;

const MINCHO_FONT =
  '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", "Noto Serif JP", serif';
const SANS_FONT =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

// ============================================================================
// 基本テキスト
// ============================================================================

interface MinchoTextProps {
  text: string;
  fontSize: number;
  color?: string;
  weight?: number;
  letterSpacing?: string;
  lineHeight?: number;
  whiteSpace?: React.CSSProperties["whiteSpace"];
  opacity?: number;
}

const MinchoText: React.FC<MinchoTextProps> = ({
  text,
  fontSize,
  color = COLORS.ivory,
  weight = 600,
  letterSpacing = "0.04em",
  lineHeight = 1.15,
  whiteSpace,
  opacity = 1,
}) => (
  <div
    style={{
      fontFamily: MINCHO_FONT,
      fontWeight: weight,
      fontSize,
      color,
      letterSpacing,
      lineHeight,
      whiteSpace,
      margin: 0,
      textAlign: "center",
      opacity,
    }}
  >
    {text}
  </div>
);

const SmallCapsLabel: React.FC<{ text: string; size?: number; color?: string }> = ({
  text,
  size = 24,
  color = COLORS.ivoryDim,
}) => (
  <div
    style={{
      fontFamily: SANS_FONT,
      fontWeight: 500,
      fontSize: size,
      color,
      letterSpacing: "0.36em",
      textTransform: "uppercase",
      textAlign: "center",
    }}
  >
    {text}
  </div>
);

// ============================================================================
// 装飾: ローズゴールドの hairline rule + diamond motif
// ============================================================================

const RoseGoldRule: React.FC<{ width?: number; thickness?: number; opacity?: number }> = ({
  width = 320,
  thickness = 1,
  opacity = 1,
}) => (
  <div
    style={{
      width,
      height: thickness,
      background: `linear-gradient(90deg, transparent 0%, ${COLORS.rosegold} 50%, transparent 100%)`,
      opacity,
    }}
  />
);

const DiamondMotif: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <div
    style={{
      width: size,
      height: size,
      transform: "rotate(45deg)",
      border: `1.5px solid ${COLORS.rosegold}`,
      background: "transparent",
    }}
  />
);

const Ornament: React.FC<{ ruleWidth?: number }> = ({ ruleWidth = 280 }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 18,
      justifyContent: "center",
    }}
  >
    <RoseGoldRule width={ruleWidth} />
    <DiamondMotif />
    <RoseGoldRule width={ruleWidth} />
  </div>
);

// ============================================================================
// アニメーション (控えめ)
// ============================================================================

const SoftFadeIn: React.FC<{
  children: React.ReactNode;
  durationFrames?: number;
  from?: number;
}> = ({ children, durationFrames = 9, from = 0.965 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, durationFrames], [0, 1], {
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, durationFrames], [from, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{ opacity, transform: `scale(${scale})`, transformOrigin: "center center" }}
    >
      {children}
    </AbsoluteFill>
  );
};

const SoftSlideUp: React.FC<{
  children: React.ReactNode;
  delayFrames: number;
  durationFrames?: number;
  distance?: number;
}> = ({ children, delayFrames, durationFrames = 8, distance = 28 }) => {
  const frame = useCurrentFrame();
  const t = interpolate(
    frame,
    [delayFrames, delayFrames + durationFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const translateY = (1 - t) * distance;
  return (
    <div style={{ opacity: t, transform: `translateY(${translateY}px)` }}>{children}</div>
  );
};

const VeryGentleZoom: React.FC<{
  children: React.ReactNode;
  durationInFrames: number;
  from?: number;
  to?: number;
}> = ({ children, durationInFrames, from = 1.0, to = 1.04 }) => {
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

// ============================================================================
// 背景: matte black + subtle marble glow
// ============================================================================

const PremiumBackground: React.FC<{ src?: string }> = ({ src }) => (
  <AbsoluteFill style={{ backgroundColor: COLORS.bgBase, overflow: "hidden" }}>
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 30% 22%, ${COLORS.bgMarbleHi} 0%, ${COLORS.bgBase} 48%, ${COLORS.bgMarbleLo} 100%)`,
      }}
    />
    {src && (
      <Img
        src={src}
        style={{
          width: "120%",
          height: "120%",
          objectFit: "cover",
          position: "absolute",
          top: "-10%",
          left: "-10%",
          filter: "blur(60px) brightness(0.32) saturate(0.55)",
          opacity: 0.16,
        }}
      />
    )}
  </AbsoluteFill>
);

// ============================================================================
// 第◯位 ランクマーク
// ============================================================================

const RankMark: React.FC<{ rank: number; size?: "large" | "corner" }> = ({
  rank,
  size = "large",
}) => {
  if (size === "corner") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <MinchoText
          text={`第${rank}位`}
          fontSize={64}
          color={COLORS.rosegold}
          weight={500}
          letterSpacing="0.06em"
        />
        <RoseGoldRule width={140} />
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 22,
      }}
    >
      <MinchoText
        text={`第${rank}位`}
        fontSize={220}
        color={COLORS.ivoryBright}
        weight={500}
        letterSpacing="0.08em"
      />
      <RoseGoldRule width={420} thickness={1.5} />
    </div>
  );
};

// ============================================================================
// 商品カード (アイボリー bg + ローズゴールド hairline frame)
// ============================================================================

const ProductCard: React.FC<{
  src: string;
  width?: number;
  height?: number;
  faded?: boolean;
}> = ({ src, width = 760, height = 960, faded = false }) => (
  <div
    style={{
      width,
      height,
      backgroundColor: "#f5ecd9",
      border: `1.5px solid ${COLORS.rosegoldSoft}`,
      boxShadow:
        "0 32px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(201,163,106,0.18)",
      overflow: "hidden",
      opacity: faded ? 0.5 : 1,
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
            "linear-gradient(135deg, #f5ecd9 0%, #ddd2b8 50%, #c2b594 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#7a6a4a",
          fontFamily: SANS_FONT,
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: "0.4em",
        }}
      >
        PRODUCT
      </div>
    )}
  </div>
);

// ============================================================================
// レビューカード (引用符付き editorial)
// ============================================================================

const ReviewCard: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      backgroundColor: COLORS.bgBase,
      border: `1px solid ${COLORS.rosegoldSoft}`,
      padding: "40px 56px",
      width: 880,
      fontFamily: MINCHO_FONT,
      fontWeight: 500,
      fontSize: 58,
      color: COLORS.ivoryBright,
      lineHeight: 1.35,
      letterSpacing: "0.04em",
      textAlign: "center",
      boxShadow: "0 22px 48px rgba(0,0,0,0.55)",
      position: "relative",
    }}
  >
    <span
      style={{
        color: COLORS.rosegold,
        fontFamily: MINCHO_FONT,
        fontSize: 90,
        lineHeight: 0.5,
        marginRight: 14,
        verticalAlign: "middle",
      }}
    >
      {"\u201C"}
    </span>
    {text}
    <span
      style={{
        color: COLORS.rosegold,
        fontFamily: MINCHO_FONT,
        fontSize: 90,
        lineHeight: 0.5,
        marginLeft: 14,
        verticalAlign: "middle",
      }}
    >
      {"\u201D"}
    </span>
  </div>
);

// ============================================================================
// シーン: OPENING (HOOK)
// ============================================================================

const OpeningScene: React.FC<{ opening: RankingOpening }> = ({ opening }) => {
  const renderLine = (
    line: RankingOpening["lines"][number],
    idx: number,
  ): React.ReactNode => {
    switch (line.variant) {
      case "red":
        return (
          <MinchoText
            key={idx}
            text={line.text}
            fontSize={260}
            color={COLORS.ivoryBright}
            weight={700}
            letterSpacing="0.08em"
          />
        );
      case "gold":
        return (
          <MinchoText
            key={idx}
            text={line.text}
            fontSize={200}
            color={COLORS.ivoryBright}
            weight={700}
            letterSpacing="0.08em"
          />
        );
      case "small-white":
        return (
          <MinchoText
            key={idx}
            text={line.text}
            fontSize={120}
            color={COLORS.ivory}
            weight={500}
            letterSpacing="0.1em"
          />
        );
      case "tiny-white":
        return (
          <MinchoText
            key={idx}
            text={line.text}
            fontSize={70}
            color={COLORS.ivoryDim}
            weight={400}
            letterSpacing="0.18em"
          />
        );
      default:
        return null;
    }
  };

  return (
    <SoftFadeIn>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          paddingLeft: 80,
          paddingRight: 80,
        }}
      >
        {opening.lines.map(renderLine)}
        <div style={{ marginTop: 24 }}>
          <Ornament ruleWidth={220} />
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
        }}
      >
        <SmallCapsLabel text="01 HOOK" size={22} />
      </div>
    </SoftFadeIn>
  );
};

// ============================================================================
// シーン: RANK INTRO (REVEAL)
// ============================================================================

const RankIntroScene: React.FC<{
  item: RankingItem;
  durationInFrames: number;
}> = ({ item, durationInFrames }) => (
  <SoftFadeIn>
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 180,
        gap: 56,
      }}
    >
      <RankMark rank={item.rank} size="large" />
      <VeryGentleZoom durationInFrames={durationInFrames}>
        <ProductCard src={item.productImagePath} width={760} height={960} />
      </VeryGentleZoom>
      <SmallCapsLabel
        text={`${item.brand} / ${item.category}`}
        size={28}
        color={COLORS.ivoryDim}
      />
    </AbsoluteFill>
    <div
      style={{
        position: "absolute",
        bottom: 80,
        left: 0,
        right: 0,
      }}
    >
      <SmallCapsLabel text={`02 RANK #${item.rank}`} size={22} />
    </div>
  </SoftFadeIn>
);

// ============================================================================
// シーン: RANK REVIEWS
// ============================================================================

const RankReviewScene: React.FC<{
  item: RankingItem;
  durationInFrames: number;
  /**
   * audioClips から計算した「シーン開始からの各レビュー開始フレーム」。
   * undefined の場合はシーン尺を 3 等分する従来挙動にフォールバック。
   */
  reviewDelayFrames?: [number, number, number];
}> = ({ item, durationInFrames, reviewDelayFrames }) => {
  const leadFrames = 6;
  const usable = Math.max(1, durationInFrames - leadFrames);
  const slot = usable / item.reviews.length;
  const delays: [number, number, number] =
    reviewDelayFrames ?? [
      Math.round(leadFrames + slot * 0),
      Math.round(leadFrames + slot * 1),
      Math.round(leadFrames + slot * 2),
    ];

  return (
    <SoftFadeIn>
      {/* 背景: 商品 (薄め) + 第◯位 (corner) */}
      <AbsoluteFill style={{ overflow: "visible" }}>
        <div style={{ position: "absolute", top: 80, right: 80 }}>
          <RankMark rank={item.rank} size="corner" />
        </div>
        <div
          style={{
            position: "absolute",
            top: 200,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <ProductCard src={item.productImagePath} width={620} height={780} faded />
        </div>
      </AbsoluteFill>
      {/* 前景: レビュー 3 枚 */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 220,
          gap: 28,
          zIndex: 2,
        }}
      >
        {item.reviews.map((text, i) => (
          <SoftSlideUp key={i} delayFrames={delays[i as 0 | 1 | 2]!}>
            <ReviewCard text={text} />
          </SoftSlideUp>
        ))}
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
        }}
      >
        <SmallCapsLabel text={`03 REVIEWS #${item.rank}`} size={22} />
      </div>
    </SoftFadeIn>
  );
};

// ============================================================================
// シーン: CLOSING
// ============================================================================

const ClosingScene: React.FC<{ text: string }> = ({ text }) => (
  <SoftFadeIn>
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 56,
        paddingLeft: 80,
        paddingRight: 80,
      }}
    >
      <Ornament ruleWidth={220} />
      <MinchoText
        text={text}
        fontSize={140}
        color={COLORS.ivoryBright}
        weight={600}
        letterSpacing="0.1em"
      />
      <Ornament ruleWidth={220} />
    </AbsoluteFill>
    <div
      style={{
        position: "absolute",
        bottom: 80,
        left: 0,
        right: 0,
      }}
    >
      <SmallCapsLabel text="04 CLOSING" size={22} />
    </div>
  </SoftFadeIn>
);

// ============================================================================
// シーン構成 (既存ロジック維持)
// ============================================================================

type SceneBlock =
  | { kind: "opening" }
  | { kind: "rank-intro"; item: RankingItem }
  | { kind: "rank-review"; item: RankingItem }
  | { kind: "closing" };

/**
 * scene index から SceneBlock の kind と対応 rank を導く。
 * 期待レイアウト (itemCount=3): [opening, r3-intro, r3-review, r2-intro, r2-review, r1-intro, r1-review, closing]
 *   length = itemCount * 2 + 2
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

  [3, 2, 1].forEach((r) => {
    const item = byRank(r as 1 | 2 | 3);
    const introSec = r === 1 ? 4.0 : 3.5;
    const reviewSec = r === 1 ? 5.0 : 4.0;
    blocks.push({ kind: "rank-intro", item, durationSec: introSec });
    blocks.push({ kind: "rank-review", item, durationSec: reviewSec });
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
    // eslint-disable-next-line no-console
    console.warn(
      `[RankingShort] scenes length=${scenes.length} did not match expected ${items.length * 2 + 2}. Falling back to fixed durations.`,
    );
  }
  return buildSceneBlocksFixed(items);
}

function computeReviewDelayByRank(
  layout: Array<{
    block: SceneBlock & { durationSec: number };
    startFrame: number;
    durationFrames: number;
    sceneStartSec: number;
  }>,
  audioClips: AudioClip[] | undefined,
  fps: number,
): Map<number, [number, number, number]> {
  const out = new Map<number, [number, number, number]>();
  if (!audioClips || audioClips.length === 0) return out;
  const rankReviewLayouts = layout.filter((l) => l.block.kind === "rank-review");
  for (const l of rankReviewLayouts) {
    const block = l.block as Extract<SceneBlock, { kind: "rank-review" }> & {
      durationSec: number;
    };
    const rank = block.item.rank;
    const reviewClips = audioClips
      .filter((c) => c.kind === "review" && c.rank === rank)
      .sort((a, b) => (a.reviewIndex ?? 0) - (b.reviewIndex ?? 0));
    if (reviewClips.length !== 3) continue;
    const delays = reviewClips.map((c) => {
      const offsetSec = Math.max(0, c.startSec - l.sceneStartSec);
      return Math.max(0, Math.round(offsetSec * fps));
    }) as [number, number, number];
    out.set(rank, delays);
  }
  return out;
}

// ============================================================================
// 全体 composition
// ============================================================================

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
  audioClips,
}) => {
  const { fps } = useVideoConfig();
  const blocks = buildSceneBlocks(items, scenes);

  let cursor = 0;
  const layout = blocks.map((block) => {
    const startFrame = Math.round(cursor * fps);
    const sceneStartSec = cursor;
    const durationFrames = Math.max(1, Math.round(block.durationSec * fps));
    cursor += block.durationSec;
    return { block, startFrame, durationFrames, sceneStartSec };
  });

  const hookSfxStart = 0;
  const rankIntroStarts = layout
    .filter((l) => l.block.kind === "rank-intro")
    .map((l) => l.startFrame);

  const reviewDelayByRank = computeReviewDelayByRank(layout, audioClips, fps);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgBase }}>
      <PremiumBackground src={backgroundImagePath} />
      {layout.map(({ block, startFrame, durationFrames }, idx) => (
        <Sequence key={idx} from={startFrame} durationInFrames={durationFrames}>
          {block.kind === "opening" ? (
            <OpeningScene opening={opening} />
          ) : block.kind === "rank-intro" ? (
            <RankIntroScene item={block.item} durationInFrames={durationFrames} />
          ) : block.kind === "rank-review" ? (
            <RankReviewScene
              item={block.item}
              durationInFrames={durationFrames}
              reviewDelayFrames={reviewDelayByRank.get(block.item.rank)}
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
