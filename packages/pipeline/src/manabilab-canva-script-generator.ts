import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import {
  ManabilabCanvaScriptSchema,
  type ManabilabCanvaScript,
  type Topic,
} from "@rekishi/shared";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";

function renderPrompt(topic: Topic, researchMd?: string): string {
  const tpl = fs.readFileSync(promptPath("script"), "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.era\}\}/g, topic.era ?? "指定なし")
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(/\{\{topic\.target\}\}/g, topic.target)
    .replace(
      /\{\{research\}\}/g,
      researchMd?.trim() ||
        "（リサーチ資料なし — 自身の知識で慎重に書くこと）",
    );
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    hook: { type: Type.STRING },
    statements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          claim: { type: Type.STRING },
          backupLogic: { type: Type.STRING },
        },
        required: ["label", "claim", "backupLogic"],
      },
    },
    cta: { type: Type.STRING },
    punchline: { type: Type.STRING },
    title: {
      type: Type.OBJECT,
      properties: {
        top: { type: Type.STRING },
        bottom: { type: Type.STRING },
      },
      required: ["top", "bottom"],
    },
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
  required: [
    "hook",
    "statements",
    "cta",
    "punchline",
    "title",
    "estimatedDurationSec",
  ],
};

export interface ManabilabCanvaScriptResult {
  script: ManabilabCanvaScript;
  prompt: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export async function generateManabilabCanvaScript(
  topic: Topic,
  researchMd?: string,
): Promise<ManabilabCanvaScriptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(topic, researchMd);

  const response = await ai.models.generateContent({
    model: config.gemini.scriptModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      // 既存の generateScript より少し高め。テンプレ決め台詞に引っ張られず、
      // ツッコミ系トーンの幅を出すため。
      temperature: 0.85,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty script response");

  const raw = JSON.parse(text) as Record<string, unknown>;
  const script = ManabilabCanvaScriptSchema.parse({
    ...raw,
    topic,
    readings: Array.isArray(raw.readings) ? raw.readings : [],
  });

  return {
    script,
    prompt,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.scriptModel,
    },
  };
}
