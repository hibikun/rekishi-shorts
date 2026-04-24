import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import { ScenePlanSchema, type Script, type ScenePlan } from "@rekishi/shared";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";

const PROMPT_NAMES = {
  single: "scene-plan",
  "three-pick": "scene-plan-three-pick",
} as const;

function renderPrompt(script: Script): string {
  const tpl = fs.readFileSync(promptPath(PROMPT_NAMES[script.topic.format]), "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, script.topic.title)
    .replace(/\{\{topic\.era\}\}/g, script.topic.era ?? "指定なし")
    .replace(/\{\{topic\.subject\}\}/g, script.topic.subject)
    .replace(/\{\{narration\}\}/g, script.narration);
}

const sceneSchema = {
  type: Type.OBJECT,
  properties: {
    index: { type: Type.NUMBER },
    narration: { type: Type.STRING },
    imageQueryJa: { type: Type.STRING },
    imageQueryEn: { type: Type.STRING },
    imagePromptEn: { type: Type.STRING },
    durationSec: { type: Type.NUMBER },
  },
  required: ["index", "narration", "imageQueryJa", "imageQueryEn", "imagePromptEn", "durationSec"],
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    scenes: { type: Type.ARRAY, items: sceneSchema },
  },
  required: ["scenes"],
};

export interface ScenePlanResult {
  plan: ScenePlan;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export async function planScenes(script: Script): Promise<ScenePlanResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(script);

  const response = await ai.models.generateContent({
    model: config.gemini.sceneModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.4,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty scene plan response");

  const raw = JSON.parse(text);
  const plan = ScenePlanSchema.parse(raw);
  return {
    plan,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.sceneModel,
    },
  };
}
