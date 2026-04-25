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

// ranking three-pick を「セグメント別 TTS」で組み上げた場合の音声マニフェスト。
// 結合済みの単一 narration.wav に加えて、各クリップの種類・ボイス・開始/終了秒を保持し、
// scene-aligner を使わなくてもシーン境界やレビュー吹き出しタイミングを決定論的に再現できる。
export const AudioClipKindSchema = z.enum([
  "opening",
  "rank-intro",
  "review",
  "closing",
]);
export type AudioClipKind = z.infer<typeof AudioClipKindSchema>;

export const AudioClipSchema = z.object({
  kind: AudioClipKindSchema,
  /** rank-intro / review のときの 1 | 2 | 3 */
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  /** review のとき 0 | 1 | 2（吹き出し配列の index と一致） */
  reviewIndex: z.number().int().min(0).max(2).optional(),
  /** Gemini TTS の voice 名（例: Kore / Puck / Aoede / Leda） */
  voice: z.string(),
  /** 個別クリップの絶対パス（結合前）。デバッグ・再合成用に保持 */
  path: z.string(),
  /** loudnorm 後 / ffprobe 計測の真の wav 長（秒） */
  durationSec: z.number().nonnegative(),
  /** 結合 narration.wav 内での開始秒 */
  startSec: z.number().nonnegative(),
  /** 結合 narration.wav 内での終了秒 */
  endSec: z.number().nonnegative(),
});
export type AudioClip = z.infer<typeof AudioClipSchema>;

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
  // セグメント別 TTS で組み上げた場合の音声マニフェスト（案G改）。
  // 与えられている場合、コンポ側はレビュー吹き出しの登場タイミングを startSec で決定でき、
  // build-ranking-plan は scene-aligner を skip して scenes 境界を audioClips から直接導出する。
  audioClips: z.array(AudioClipSchema).optional(),
  createdAt: z.string().describe("ISO 8601"),
});
export type RankingPlan = z.infer<typeof RankingPlanSchema>;
