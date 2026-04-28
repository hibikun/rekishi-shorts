import React from "react";
import { Composition, staticFile } from "remotion";
import { UKIYOE_VIDEO_FPS, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@rekishi/shared";
import { HistoryShort, type HistoryShortProps } from "./compositions/HistoryShort";
import { RankingShort, type RankingShortProps } from "./compositions/RankingShort";
import { UkiyoeShort, type UkiyoeShortProps } from "./compositions/UkiyoeShort";
import { ManabilabShort, type ManabilabShortProps } from "./compositions/ManabilabShort";

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

const ukiyoeDefaultProps: UkiyoeShortProps = {
  scenes: [],
  audioSrc: "",
  captions: [],
  captionSegments: [],
  totalDurationSec: 20,
  keyTerms: [],
  openingSfxSrc: "",
  cheerSfxSrc: "",
};

const UkiyoeShortComponent = UkiyoeShort as unknown as React.FC<Record<string, unknown>>;

// manabilab 動画001「ノートまとめは時間の無駄」本番構成 (10シーン / 35.06秒)
// 全シーンが Seedance V1 Lite で animation 化された video clip ベース。
// 各 scene の durationSec は VOICEVOX speaker=13 出力のタイムスタンプ。
const VIDEO_PREFIX = "manabilab/videos/001-note-matome";
const seedanceClip = (n: number) => staticFile(`${VIDEO_PREFIX}/scene-${String(n).padStart(2, "0")}.mp4`);

/**
 * 1 ナレーション文を複数チャンクに分割し、文字数比例で時間割り当てして字幕セグメント列に変換。
 * Bro Pump 風に "短いフレーズが順次出る" もっさり感ゼロの字幕を作る。
 */
function chunkCaption(start: number, end: number, parts: string[]): Array<{ text: string; startSec: number; endSec: number }> {
  const dur = end - start;
  const totalChars = parts.reduce((s, p) => s + p.length, 0);
  let cursor = start;
  return parts.map((p) => {
    const segDur = (p.length / totalChars) * dur;
    const seg = { text: p, startSec: cursor, endSec: cursor + segDur };
    cursor += segDur;
    return seg;
  });
}

const manabilabDefaultProps: ManabilabShortProps = {
  scenes: [
    // [0.00-5.13] HOOK
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/03-wrong-way-highlighting.png"),
      videoSrc: seedanceClip(1),
      durationSec: 5.13,
    },
    // [5.13-8.10] REFRAME 法則アンカー
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/08-thinking-brain-aura.png"),
      videoSrc: seedanceClip(2),
      durationSec: 2.97,
    },
    // [8.10-9.59] Method 1 開幕
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/09-recalling-with-effort.png"),
      videoSrc: seedanceClip(3),
      durationSec: 1.49,
    },
    // [9.59-11.91] Method 1 動作 (キャラ瞑想)
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/04-recall-practice-glow.png"),
      videoSrc: seedanceClip(4),
      durationSec: 2.32,
    },
    // [11.91-19.84] Method 1 エビデンス (Karpicke)
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/06-pointing-two-fingers.png"),
      videoSrc: seedanceClip(5),
      durationSec: 7.93,
    },
    // [19.84-21.33] Method 2 開幕
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/10-calendar-overview.png"),
      videoSrc: seedanceClip(6),
      durationSec: 1.49,
    },
    // [21.33-24.64] Method 2 動作 (キャラ + カレンダー)
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/07-spread-study-calendar.png"),
      videoSrc: seedanceClip(7),
      durationSec: 3.31,
    },
    // [24.64-29.27] Method 2 エビデンス (エビングハウス vintage)
    {
      kind: "image",
      src: staticFile("manabilab/brolls/v1/broll-02-ebbinghaus-vintage.png"),
      videoSrc: seedanceClip(8),
      durationSec: 4.63,
    },
    // [29.27-31.42] CLOSING 序 (期間提示)
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/01-hero-front-standing.png"),
      videoSrc: seedanceClip(9),
      durationSec: 2.15,
    },
    // [31.42-35.06] CLOSING 結 (triumph + 強発光)
    {
      kind: "image",
      src: staticFile("manabilab/character/v1/05-triumph-flex.png"),
      videoSrc: seedanceClip(10),
      durationSec: 3.64,
    },
  ],
  totalDurationSec: 35.06,
  audioSrc: staticFile("manabilab/audio/narration-001.wav"),
  // 全 manabilab 動画共通 BGM（フェード IN/OUT 付き、ナレ優先で控えめ音量）
  bgmSrc: staticFile("manabilab/bgm/uplifting-trance.mp3"),
  bgmVolume: 0.05,
  captionSegments: [
    // 各文を 2-4 個の自然な節 (主に「、」/ 助詞境界) に分割
    ...chunkCaption(0.0, 5.13, [
      "ノートをまとめることに",
      "時間を割くのが",
      "記憶が定着しない",
      "原因です。",
    ]),
    ...chunkCaption(5.13, 8.1, ["認知科学の法則に従って", "勉強するだけ。"]),
    ...chunkCaption(8.1, 9.59, ["1つ目、想起練習。"]),
    ...chunkCaption(9.59, 11.91, ["ノートを閉じて", "思い出すだけ。"]),
    ...chunkCaption(11.91, 19.84, [
      "Karpickeの研究で、",
      "思い出したグループは、",
      "読み返したグループより",
      "記憶定着が2倍以上でした。",
    ]),
    ...chunkCaption(19.84, 21.33, ["2つ目、分散学習。"]),
    ...chunkCaption(21.33, 24.64, [
      "1日3時間より、",
      "3日に分けて",
      "1時間ずつ。",
    ]),
    ...chunkCaption(24.64, 29.27, [
      "これは100年以上前から",
      "証明されている",
      "分散学習効果です。",
    ]),
    ...chunkCaption(29.27, 31.42, ["2週間続けて", "みてください。"]),
    ...chunkCaption(31.42, 35.06, [
      "次のテストで、",
      "驚くほどスラスラ",
      "思い出せます。",
    ]),
  ],
};

const ManabilabShortComponent = ManabilabShort as unknown as React.FC<Record<string, unknown>>;

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
        id="UkiyoeShort"
        component={UkiyoeShortComponent}
        durationInFrames={UKIYOE_VIDEO_FPS * 60}
        fps={UKIYOE_VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={ukiyoeDefaultProps as unknown as Record<string, unknown>}
      />
      <Composition
        id="ManabilabShort"
        component={ManabilabShortComponent}
        durationInFrames={Math.ceil(manabilabDefaultProps.totalDurationSec * VIDEO_FPS)}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={manabilabDefaultProps as unknown as Record<string, unknown>}
      />
    </>
  );
};
