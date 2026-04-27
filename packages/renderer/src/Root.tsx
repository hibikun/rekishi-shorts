import React from "react";
import { Composition, staticFile } from "remotion";
import {
  KOSEI_ANIMATION_VIDEO_FPS,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "@rekishi/shared";
import { HistoryShort, type HistoryShortProps } from "./compositions/HistoryShort";
import { RankingShort, type RankingShortProps } from "./compositions/RankingShort";
import {
  KoseiAnimationShort,
  type KoseiAnimationShortProps,
} from "./compositions/KoseiAnimationShort";

const defaultProps: HistoryShortProps = {
  scenes: [],
  images: [],
  audioSrc: "",
  captions: [],
  captionSegments: [],
  totalDurationSec: 60,
  keyTerms: [],
  title: { top: "", bottom: "" },
  hookSfxSrc: "",
  openingSfxSrc: "",
  cheerSfxSrc: "",
};

const HistoryShortComponent = HistoryShort as unknown as React.FC<Record<string, unknown>>;

const rankingDefaultProps: RankingShortProps = {
  opening: {
    lines: [
      { text: "5,000円以下で", variant: "small-white" },
      { text: "生活が", variant: "red" },
      { text: "ガチで捗る", variant: "red" },
      { text: "アマゾンで", variant: "gold" },
      { text: "買える", variant: "gold" },
      { text: "神商品", variant: "gold" },
      { text: "挙げてくw", variant: "tiny-white" },
    ],
    icons: [
      { emoji: "📱", size: 180 },
      { emoji: "🧥", size: 200 },
      { emoji: "🧑‍💼", size: 260 },
      { emoji: "👩", size: 260 },
      { emoji: "📻", size: 180 },
      { emoji: "✨", size: 160 },
    ],
  },
  items: [
    {
      rank: 3,
      brand: "サンプル",
      category: "電動爪切り",
      productImagePath: staticFile("ranking-samples/product-3.jpg"),
      reviews: [
        "爪切りが超苦手な私を救ってくれた神商品",
        "想像よりも綺麗になってビックリしたわ",
        "爪綺麗になるだけでまじテンション上がる",
      ],
    },
    {
      rank: 2,
      brand: "サンプル",
      category: "モバイルバッテリー",
      productImagePath: staticFile("ranking-samples/product-2.jpg"),
      reviews: [
        "ケーブル不要で充電できるのまじ革命",
        "薄くて邪魔にならない",
        "外出時の安心感が段違い",
      ],
    },
    {
      rank: 1,
      brand: "サンプル",
      category: "スマート延長コード",
      productImagePath: staticFile("ranking-samples/product-1.jpg"),
      reviews: [
        "デスク周りがスッキリしすぎて感動",
        "一度使うと普通の延長コードに戻れない",
        "地味だけど生活の質が上がる",
      ],
    },
  ],
  backgroundImagePath: staticFile("ranking-samples/background.jpg"),
  closing: { text: "詳細は\n概要欄にまとめた" },
  totalDurationSec: 30,
};

const RankingShortComponent = RankingShort as unknown as React.FC<Record<string, unknown>>;

const koseiAnimationDefaultProps: KoseiAnimationShortProps = {
  scenes: [],
  audioSrc: "",
  captions: [],
  captionSegments: [],
  totalDurationSec: 40,
  keyTerms: [],
  title: { top: "", bottom: "" },
};

const KoseiAnimationShortComponent =
  KoseiAnimationShort as unknown as React.FC<Record<string, unknown>>;

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="HistoryShort"
        component={HistoryShortComponent}
        durationInFrames={VIDEO_FPS * 60}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultProps as unknown as Record<string, unknown>}
      />
      <Composition
        id="RankingShort"
        component={RankingShortComponent}
        durationInFrames={VIDEO_FPS * 30}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={rankingDefaultProps as unknown as Record<string, unknown>}
      />
      <Composition
        id="KoseiAnimationShort"
        component={KoseiAnimationShortComponent}
        durationInFrames={KOSEI_ANIMATION_VIDEO_FPS * 60}
        fps={KOSEI_ANIMATION_VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={koseiAnimationDefaultProps as unknown as Record<string, unknown>}
      />
    </>
  );
};
