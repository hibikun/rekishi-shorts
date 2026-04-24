import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import { ScriptSchema, type Script, type Topic } from "@rekishi/shared";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";

const PROMPT_NAMES = {
  single: "script",
  "three-pick": "script-three-pick",
} as const;

function renderPrompt(topic: Topic, researchMd?: string): string {
  const tpl = fs.readFileSync(promptPath(PROMPT_NAMES[topic.format]), "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.era\}\}/g, topic.era ?? "指定なし")
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(/\{\{topic\.target\}\}/g, topic.target)
    .replace(/\{\{research\}\}/g, researchMd?.trim() || "（リサーチ資料なし — 自身の知識で慎重に書くこと）");
}

const titleResponseSchema = {
  type: Type.OBJECT,
  properties: {
    top: { type: Type.STRING },
    bottom: { type: Type.STRING },
  },
  required: ["top", "bottom"],
};

const singleResponseSchema = {
  type: Type.OBJECT,
  properties: {
    narration: { type: Type.STRING },
    hook: { type: Type.STRING },
    title: titleResponseSchema,
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
  required: ["narration", "hook", "title", "body", "closing", "keyTerms", "estimatedDurationSec"],
};

const threePickResponseSchema = {
  type: Type.OBJECT,
  properties: {
    narration: { type: Type.STRING },
    hook: { type: Type.STRING },
    title: titleResponseSchema,
    body: { type: Type.STRING },
    closing: { type: Type.STRING },
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
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          rank: { type: Type.NUMBER },
          name: { type: Type.STRING },
          summary: { type: Type.STRING },
          // ranking 用フィールド。rekishi / kosei では LLM が省略してよい。
          brand: { type: Type.STRING },
          category: { type: Type.STRING },
          reviews: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          priceRangeJpy: { type: Type.STRING },
          affiliateUrl: { type: Type.STRING },
          officialUrl: { type: Type.STRING },
          searchKeywords: { type: Type.STRING },
        },
        required: ["rank", "name", "summary"],
      },
    },
    estimatedDurationSec: { type: Type.NUMBER },
  },
  required: ["narration", "hook", "title", "body", "closing", "keyTerms", "items", "estimatedDurationSec"],
};

const RESPONSE_SCHEMAS = {
  single: singleResponseSchema,
  "three-pick": threePickResponseSchema,
} as const;

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

export async function generateScript(topic: Topic, researchMd?: string): Promise<ScriptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(topic, researchMd);

  const response = await ai.models.generateContent({
    model: config.gemini.scriptModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMAS[topic.format],
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
