import { z } from "zod";
import { CaptionSegmentSchema, CaptionWordSchema } from "./asset";
import { SceneSchema } from "./script";

// ========================================================================
// ranking チャンネル専用の RenderPlan
//
// HistoryShort とは別composition・別データ構造のため、独自スキーマとして分離。
// render pipeline 側は channel 判定でこのスキーマを読む。
// ========================================================================

export const RankingItemSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  brand: z.string().min(1),
  category: z.string().min(1),
  productImagePath: z.string().describe("商品画像の絶対パス（stage前）"),
  reviews: z
    .tuple([z.string(), z.string(), z.string()])
    .describe("吹き出しレビュー3枚"),
  // リサーチ段階で保持する補足情報（画面には出さないがメタとして保持）
  affiliateUrl: z.string().optional(),
  priceRangeJpy: z.string().optional(),
  productName: z.string().optional().describe("商品のフルネーム (category との違いはバリアント名)"),
});
export type RankingItem = z.infer<typeof RankingItemSchema>;

export const OpeningLineVariantSchema = z.enum([
  "small-white",
  "red",
  "gold",
  "tiny-white",
]);

export const OpeningLineSchema = z.object({
  text: z.string(),
  variant: OpeningLineVariantSchema,
});

export const OpeningIconSchema = z.object({
  src: z.string().optional(),
  emoji: z.string().optional(),
  size: z.number().positive().optional(),
});

export const RankingOpeningSchema = z.object({
  lines: z.array(OpeningLineSchema).min(1),
  icons: z.array(OpeningIconSchema).optional(),
});

export const RankingPlanSchema = z.object({
  id: z.string().describe("ジョブID (uuid or timestamp)"),
  opening: RankingOpeningSchema,
  items: z.tuple([RankingItemSchema, RankingItemSchema, RankingItemSchema]),
  backgroundImagePath: z.string().describe("ブラー背景の絶対パス（stage前）"),
  closing: z.object({ text: z.string() }),
  totalDurationSec: z.number().positive(),
  // 音声系（いずれもオプショナル）
  audioPath: z.string().optional().describe("ナレーション音声"),
  bgmPath: z.string().optional().describe("BGM（低音量でループ）"),
  rankSfxPath: z.string().optional().describe("ランク登場SFX"),
  hookSfxPath: z.string().optional().describe("オープニング冒頭SFX"),
  // Whisper 字幕（後段で拡張する場合用）
  captions: z.array(CaptionWordSchema).default([]),
  captionSegments: z.array(CaptionSegmentSchema).default([]),
  // scene-aligner で実音声に合わせて durationSec を上書きした Scene 列。
  // 8 シーン固定 (opening / rank3-intro / rank3-review / rank2-intro / rank2-review /
  // rank1-intro / rank1-review / closing)。コンポ側はこの長さの合計と各 durationSec を
  // 使ってスライド進行を制御する。未指定時は固定尺フォールバック（既存ジョブ互換）。
  scenes: z.array(SceneSchema).optional(),
  createdAt: z.string().describe("ISO 8601"),
});
export type RankingPlan = z.infer<typeof RankingPlanSchema>;
