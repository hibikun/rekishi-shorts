import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import type {
  CanvaSceneSource,
  ManabilabCanvaScene,
  Topic,
} from "@rekishi/shared";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";

function sourceLabel(source: CanvaSceneSource): string {
  switch (source.kind) {
    case "hook":
      return "hook";
    case "statement":
      return `statement-${source.statementIndex + 1}`;
    case "cta":
      return "cta";
    case "punchline":
      return "punchline";
  }
}

/**
 * バリアントごとの差別化指示。3 案を完全独立な構図で出すための骨格指示。
 * variantIndex は 0..VARIANT_DIRECTIVES.length-1 で循環する。
 */
export const VARIANT_DIRECTIVES: ReadonlyArray<{
  label: string;
  directive: string;
}> = [
  {
    label: "正面・全身・典型構図",
    directive:
      "Variant 0 = 王道の構図。全身ショット（full body）、正面〜やや 3/4 のカメラ、両足は地面に。視聴者と素直に向き合うポーズで、シーンの主旨を最もストレートに表現する。小道具がある場合は両手で持つ／顔の前に掲げる など、はっきり見せる。",
  },
  {
    label: "上半身・斜め・表情強調",
    directive:
      "Variant 1 = 表情・上半身に寄せる。upper body or chest-up shot、カメラはやや横（3/4 side or near-profile）、身体を斜めにひねって動きを出す。手は顔まわり（頬・額・口元）に置いて感情を強調する。Variant 0 と同じ正面ベタ立ちは禁止。",
  },
  {
    label: "引き・俯瞰 or アクション・別アングル",
    directive:
      "Variant 2 = 思い切って外す案。引き（wide shot）、低い位置からの煽り（low angle）、もしくは真上からの俯瞰（high angle / overhead）など、Variant 0/1 と被らないカメラを選ぶ。動きを大きく（ジャンプ・しゃがみ・走る・空気椅子・後ろ姿）。小道具を「使わない／別の関わり方」で見せる。",
  },
];

export const DEFAULT_VARIANT_COUNT = VARIANT_DIRECTIVES.length;

function renderPrompt(
  scene: ManabilabCanvaScene,
  topic: Topic,
  options: {
    variantIndex: number;
    variantCount: number;
    userDirection?: string;
    otherVariantsHint?: string;
  },
): string {
  const tpl = fs.readFileSync(promptPath("image-prompt"), "utf-8");
  const direction = (options.userDirection ?? scene.imagePromptJa ?? "").trim();
  const variantSpec = VARIANT_DIRECTIVES[
    options.variantIndex % VARIANT_DIRECTIVES.length
  ]!;
  return tpl
    .replace(/\{\{scene\.index\}\}/g, String(scene.index))
    .replace(/\{\{scene\.sourceLabel\}\}/g, sourceLabel(scene.source))
    .replace(/\{\{scene\.caption\}\}/g, scene.caption)
    .replace(/\{\{scene\.narration\}\}/g, scene.narration)
    .replace(/\{\{userDirection\}\}/g, direction || "（指示なし）")
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.target\}\}/g, topic.target)
    .replace(/\{\{variantIndex\}\}/g, String(options.variantIndex))
    .replace(/\{\{variantCount\}\}/g, String(options.variantCount))
    .replace(/\{\{variantDirective\}\}/g, variantSpec.directive)
    .replace(
      /\{\{otherVariantsHint\}\}/g,
      (options.otherVariantsHint ?? "").trim() || "（他案の情報なし）",
    );
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    imagePromptEn: { type: Type.STRING },
    poseSummaryJa: { type: Type.STRING },
  },
  required: ["imagePromptEn", "poseSummaryJa"],
};

export interface ImagePromptResult {
  imagePromptEn: string;
  poseSummaryJa: string;
  variantIndex: number;
  variantLabel: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export interface GenerateImagePromptOptions {
  /** 何番目のバリアントを書くか（0/1/2…）。省略時は 0 */
  variantIndex?: number;
  /** 何案中の何番目か。プロンプトに埋めて差別化を促す。省略時は DEFAULT_VARIANT_COUNT */
  variantCount?: number;
  /** ユーザーの日本語ポーズ指示。空なら scene.imagePromptJa を使う */
  userDirection?: string;
  /** 同じシーンで他バリアントが既に決まっている場合、その英語プロンプトの要約を渡すと差別化が強まる */
  otherVariantsHint?: string;
}

/**
 * 1 シーン × 1 バリアントの英語画像プロンプトを Gemini で生成する。
 * 3 案出したい場合は variantIndex 0/1/2 で 3 回呼び出す（並列推奨）。
 */
export async function generateImagePromptForScene(
  scene: ManabilabCanvaScene,
  topic: Topic,
  options: GenerateImagePromptOptions = {},
): Promise<ImagePromptResult> {
  const variantIndex = options.variantIndex ?? 0;
  const variantCount = options.variantCount ?? DEFAULT_VARIANT_COUNT;
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(scene, topic, {
    variantIndex,
    variantCount,
    userDirection: options.userDirection,
    otherVariantsHint: options.otherVariantsHint,
  });

  const response = await ai.models.generateContent({
    // 画像プロンプト生成は scene-plan 並みの軽い処理なので flash-lite で十分
    model: config.gemini.sceneModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      // 3 案で散らしたいので少し高めの温度
      temperature: 0.9,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty image prompt response");

  const raw = JSON.parse(text) as {
    imagePromptEn?: unknown;
    poseSummaryJa?: unknown;
  };
  if (typeof raw.imagePromptEn !== "string" || !raw.imagePromptEn.trim()) {
    throw new Error("imagePromptEn is missing or empty");
  }
  const poseSummaryJa =
    typeof raw.poseSummaryJa === "string" ? raw.poseSummaryJa : "";

  const variantSpec =
    VARIANT_DIRECTIVES[variantIndex % VARIANT_DIRECTIVES.length]!;

  return {
    imagePromptEn: raw.imagePromptEn.trim(),
    poseSummaryJa: poseSummaryJa.trim(),
    variantIndex,
    variantLabel: variantSpec.label,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.sceneModel,
    },
  };
}
