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
  const tpl = fs.readFileSync(promptPath("animation-prompt"), "utf-8");
  const direction = (userDirection ?? scene.seedancePromptJa ?? "").trim();
  return tpl
    .replace(/\{\{scene\.index\}\}/g, String(scene.index))
    .replace(/\{\{scene\.sourceLabel\}\}/g, sourceLabel(scene.source))
    .replace(/\{\{scene\.caption\}\}/g, scene.caption)
    .replace(/\{\{scene\.narration\}\}/g, scene.narration)
    .replace(
      /\{\{scene\.imagePromptEn\}\}/g,
      (scene.imagePromptEn ?? "").trim() || "(画像プロンプトなし)",
    )
    .replace(/\{\{userDirection\}\}/g, direction || "（指示なし）")
    .replace(/\{\{topic\.title\}\}/g, topic.title);
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    animationPromptEn: { type: Type.STRING },
    motionSummaryJa: { type: Type.STRING },
  },
  required: ["animationPromptEn", "motionSummaryJa"],
};

export interface AnimationPromptResult {
  animationPromptEn: string;
  motionSummaryJa: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export async function generateAnimationPromptForScene(
  scene: ManabilabCanvaScene,
  topic: Topic,
  userDirection?: string,
): Promise<AnimationPromptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(scene, topic, userDirection);

  const response = await ai.models.generateContent({
    model: config.gemini.sceneModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.7,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty animation prompt response");

  const raw = JSON.parse(text) as {
    animationPromptEn?: unknown;
    motionSummaryJa?: unknown;
  };
  if (
    typeof raw.animationPromptEn !== "string" ||
    !raw.animationPromptEn.trim()
  ) {
    throw new Error("animationPromptEn is missing or empty");
  }
  const motionSummaryJa =
    typeof raw.motionSummaryJa === "string" ? raw.motionSummaryJa : "";

  return {
    animationPromptEn: raw.animationPromptEn.trim(),
    motionSummaryJa: motionSummaryJa.trim(),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.sceneModel,
    },
  };
}
