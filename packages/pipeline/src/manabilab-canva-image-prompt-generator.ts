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

function renderPrompt(
  scene: ManabilabCanvaScene,
  topic: Topic,
  userDirection?: string,
): string {
  const tpl = fs.readFileSync(promptPath("image-prompt"), "utf-8");
  const direction = (userDirection ?? scene.imagePromptJa ?? "").trim();
  return tpl
    .replace(/\{\{scene\.index\}\}/g, String(scene.index))
    .replace(/\{\{scene\.sourceLabel\}\}/g, sourceLabel(scene.source))
    .replace(/\{\{scene\.caption\}\}/g, scene.caption)
    .replace(/\{\{scene\.narration\}\}/g, scene.narration)
    .replace(/\{\{userDirection\}\}/g, direction || "（指示なし）")
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.target\}\}/g, topic.target);
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
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export async function generateImagePromptForScene(
  scene: ManabilabCanvaScene,
  topic: Topic,
  userDirection?: string,
): Promise<ImagePromptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(scene, topic, userDirection);

  const response = await ai.models.generateContent({
    // 画像プロンプト生成は scene-plan 並みの軽い処理なので flash-lite で十分
    model: config.gemini.sceneModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.7,
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

  return {
    imagePromptEn: raw.imagePromptEn.trim(),
    poseSummaryJa: poseSummaryJa.trim(),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.sceneModel,
    },
  };
}
