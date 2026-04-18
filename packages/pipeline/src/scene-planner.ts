import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScenePlanSchema, type Script, type ScenePlan } from "@rekishi/shared";
import { config } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_TEMPLATE_PATH = path.resolve(__dirname, "../prompts/scene-plan.md");

function renderPrompt(script: Script): string {
  const tpl = fs.readFileSync(PROMPT_TEMPLATE_PATH, "utf-8");
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

export async function planScenes(script: Script): Promise<ScenePlan> {
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
  return plan;
}
