import { z } from "zod";

export const SubjectSchema = z.enum(["日本史", "世界史"]);
export type Subject = z.infer<typeof SubjectSchema>;

export const TargetSchema = z.enum(["共通テスト", "二次", "汎用"]);
export type Target = z.infer<typeof TargetSchema>;

export const TopicSchema = z.object({
  title: z.string().min(1).describe("トピック名。例: ペリー来航 / フランス革命"),
  era: z.string().optional().describe("時代名。例: 幕末 / 近世"),
  subject: SubjectSchema.default("日本史"),
  target: TargetSchema.default("汎用"),
});
export type Topic = z.infer<typeof TopicSchema>;

// AI が生成する台本本体
export const ScriptSchema = z.object({
  topic: TopicSchema,
  // 60秒 = 約300-400文字を想定
  narration: z.string().min(100).describe("ナレーション全文。句読点込み"),
  hook: z.string().describe("掴みの1-2文"),
  body: z.string().describe("本文"),
  closing: z.string().describe("締めの1文"),
  mnemonic: z.string().optional().describe("年号語呂合わせ"),
  keyTerms: z.array(z.string()).describe("動画に登場する教科書用語"),
  // 難読な人名・地名・歴史用語の読み仮名マップ。TTS の誤読防止用途で、字幕には反映しない。
  readings: z
    .record(z.string())
    .default({})
    .describe("難読語の読み仮名。例: { '阿部正弘': 'あべまさひろ' }"),
  estimatedDurationSec: z.number().describe("推定秒数"),
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
