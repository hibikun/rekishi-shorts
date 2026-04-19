import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScriptSchema, type Script, type Topic } from "@rekishi/shared";
import { config } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_TEMPLATE_PATH = path.resolve(__dirname, "../prompts/script.md");

function renderPrompt(topic: Topic): string {
  const tpl = fs.readFileSync(PROMPT_TEMPLATE_PATH, "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.era\}\}/g, topic.era ?? "指定なし")
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(/\{\{topic\.target\}\}/g, topic.target);
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    narration: { type: Type.STRING },
    hook: { type: Type.STRING },
    body: { type: Type.STRING },
    closing: { type: Type.STRING },
    mnemonic: { type: Type.STRING },
    keyTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
    readings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          reading: { type: Type.STRING },
        },
        required: ["term", "reading"],
      },
    },
    estimatedDurationSec: { type: Type.NUMBER },
  },
  required: ["narration", "hook", "body", "closing", "keyTerms", "estimatedDurationSec"],
};

export interface ScriptResult {
  script: Script;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

function readingsArrayToMap(arr: Array<{ term: string; reading: string }> | undefined): Record<string, string> {
  if (!Array.isArray(arr)) return {};
  const out: Record<string, string> = {};
  for (const { term, reading } of arr) {
    if (term && reading && !out[term]) out[term] = reading;
  }
  return out;
}

export async function generateScript(topic: Topic): Promise<ScriptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(topic);

  const response = await ai.models.generateContent({
    model: config.gemini.scriptModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.7,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty script response");

  const raw = JSON.parse(text) as { readings?: Array<{ term: string; reading: string }> } & Record<string, unknown>;
  const readings = readingsArrayToMap(raw.readings);
  const script = ScriptSchema.parse({ ...raw, readings, topic });
  return {
    script,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.scriptModel,
    },
  };
}
