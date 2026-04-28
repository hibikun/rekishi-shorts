import { z } from "zod";

// チャンネル横断で自由入力。例: 日本史 / 世界史 / 生物 / 化学 / 物理 / 地学 / 政治経済
export const SubjectSchema = z.string().min(1).default("日本史");
export type Subject = z.infer<typeof SubjectSchema>;

export const TargetSchema = z.enum(["共通テスト", "二次", "汎用"]);
export type Target = z.infer<typeof TargetSchema>;

export const ScriptFormatSchema = z.enum(["single", "three-pick"]).default("single");
export type ScriptFormat = z.infer<typeof ScriptFormatSchema>;

export const TopicSchema = z.object({
  title: z.string().min(1).describe("トピック名。例: ペリー来航 / フランス革命"),
  era: z.string().optional().describe("時代名。例: 幕末 / 近世"),
  subject: SubjectSchema.default("日本史"),
  target: TargetSchema.default("汎用"),
  format: ScriptFormatSchema,
});
export type Topic = z.infer<typeof TopicSchema>;

export const ThreePickItemSchema = z.object({
  rank: z.number().int().min(1).max(3),
  name: z.string().min(1),
  summary: z.string().min(1).describe("このランクの驚きポイントを含む1-2文"),
  // ranking チャンネル用の拡張フィールド（optional。rekishi / kosei では未使用）
  brand: z.string().optional().describe("ブランド名。ranking 用"),
  category: z.string().optional().describe("商品カテゴリ。ranking 用"),
  reviews: z
    .tuple([z.string(), z.string(), z.string()])
    .optional()
    .describe("レビュー吹き出し3枚。ranking 用"),
  priceRangeJpy: z.string().optional().describe("価格帯。ranking 用"),
  affiliateUrl: z.string().optional().describe("概要欄アフィリエイトURL。ranking 用"),
  officialUrl: z
    .string()
    .optional()
    .describe("公式/メーカーページ URL。画像取得元の第一候補。ranking 用"),
  searchKeywords: z
    .string()
    .optional()
    .describe("商品画像検索用キーワード。URL が無いとき人間が使う。ranking 用"),
});
export type ThreePickItem = z.infer<typeof ThreePickItemSchema>;

export const VideoTitleSchema = z.object({
  top: z
    .string()
    .max(15)
    .describe(
      "タイトル上段（小）— 主語/前振り。空文字 \"\" でサブタイトル無し（ranking 新仕様）。例: 年収200億の男が / なぜ信長は",
    ),
  bottom: z
    .string()
    .min(1)
    .max(20)
    .describe(
      "タイトル下段（大）— 核/オチ。改行は \"/\" で指示可（ranking）。例: 毎朝行う2つの習慣。 / 目黒で外さない/デート飯3選",
    ),
});
export type VideoTitle = z.infer<typeof VideoTitleSchema>;

// ranking three-pick で narration を構造化セグメントとして出力する場合の単位。
// kind は 8 シーンの「ナレーター枠」5 つに対応 (opening / rank3-intro / rank2-intro / rank1-intro / closing)。
// レビュー枠 (rank3/2/1-review) は items[].reviews を別ボイスで合成するため segments には含めない。
export const NarrationSegmentKindSchema = z.enum([
  "opening",
  "rank3-intro",
  "rank2-intro",
  "rank1-intro",
  "closing",
]);
export type NarrationSegmentKind = z.infer<typeof NarrationSegmentKindSchema>;

export const NarrationSegmentSchema = z.object({
  kind: NarrationSegmentKindSchema,
  text: z.string().min(1).describe("このセグメントで読み上げるナレーションテキスト"),
});
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;

// AI が生成する台本本体
export const ScriptSchema = z.object({
  topic: TopicSchema,
  // 60秒 = 約300-400文字を想定。ranking three-pick はナレーター枠のみ短く（80字前後）なる
  narration: z.string().min(50).describe("ナレーション全文。句読点込み"),
  hook: z.string().describe("掴みの1-2文"),
  title: VideoTitleSchema.describe("動画全編に常時表示する2行タイトル。上段(前振り)+下段(核/オチ)"),
  body: z.string().describe("本文"),
  closing: z.string().describe("締めの1文"),
  mnemonic: z.string().optional().describe("年号語呂合わせ"),
  // チャンネルにより不要（manabilab など）。default([]) で空配列を許容。
  keyTerms: z.array(z.string()).default([]).describe("動画に登場する教科書用語（チャンネルによっては未使用）"),
  // 難読な人名・地名・歴史用語の読み仮名マップ。TTS の誤読防止用途で、字幕には反映しない。
  readings: z
    .record(z.string())
    .default({})
    .describe("難読語の読み仮名。例: { '阿部正弘': 'あべまさひろ' }"),
  estimatedDurationSec: z.number().describe("推定秒数"),
  items: z
    .array(ThreePickItemSchema)
    .optional()
    .describe("three-pick format 時のランキング項目"),
  // ranking three-pick で「ナレーター枠」を 5 セグメントに分けて読み上げ、
  // レビュー枠は items[].reviews を別ボイスで読む新フロー用。未指定時は従来 narration 一本流し。
  narrationSegments: z
    .array(NarrationSegmentSchema)
    .optional()
    .describe(
      "ranking three-pick 用: opening / rank3-intro / rank2-intro / rank1-intro / closing の5枠",
    ),
});
export type Script = z.infer<typeof ScriptSchema>;

export const SceneSchema = z.object({
  index: z.number().int().nonnegative(),
  narration: z.string().describe("このシーンで話すナレーション部分"),
  imageQueryJa: z.string().describe("Wikimedia検索用の日本語クエリ"),
  imageQueryEn: z.string().describe("Wikimedia検索用の英語クエリ"),
  imagePromptEn: z.string().describe("Nano Banana にフォールバックする場合の英語プロンプト"),
  durationSec: z.number().positive().describe("このシーンの表示時間秒"),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScenePlanSchema = z.object({
  scenes: z.array(SceneSchema).min(3).max(30),
});
export type ScenePlan = z.infer<typeof ScenePlanSchema>;
