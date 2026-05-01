import { z } from "zod";

/**
 * self-motivation チャンネル用の Topic スキーマ。
 *
 * 既存のショート動画用 `TopicSchema` (`./script.ts`) は
 * `target: "共通テスト" | "二次" | "汎用"`、`format: "single" | "three-pick"` という
 * 受験/ランキング向け enum を持つが、自己啓発チャンネルでは使わない。
 * Gemini の自由応答が enum で弾かれる事故を防ぐため、self-motivation では
 * 必要最小限のフィールドのみを持つ独自スキーマを使う。
 */
export const SelfMotivationTopicSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("動画のタイトル/テーマ。例: '朝5時起きで人生が変わる脳科学的理由'"),
  subject: z
    .string()
    .min(1)
    .default("自己啓発")
    .describe("カテゴリ。例: 自己啓発 / 行動科学 / 習慣 / キャリア"),
});
export type SelfMotivationTopic = z.infer<typeof SelfMotivationTopicSchema>;
