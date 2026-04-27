import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";

export interface KoseiAnimationScriptInput {
  topic: string;
  era?: string;
  researchMd?: string;
  targetDurationSec?: number;
  targetSceneCount?: number;
}

export interface KoseiAnimationScript {
  topic: string;
  era: string | null;
  hook: string;
  title: { top: string; bottom: string };
  narration: string;
  body: string;
  closing: string;
  keyTerms: string[];
  readings: Record<string, string>;
  estimatedDurationSec: number;
  targetSceneCount: number;
}

export interface KoseiAnimationScriptResult {
  script: KoseiAnimationScript;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    narration: { type: Type.STRING },
    hook: { type: Type.STRING },
    title: {
      type: Type.OBJECT,
      properties: {
        top: { type: Type.STRING },
        bottom: { type: Type.STRING },
      },
      required: ["top", "bottom"],
    },
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
    estimatedDurationSec: { type: Type.NUMBER },
  },
  required: [
    "narration",
    "hook",
    "title",
    "body",
    "closing",
    "keyTerms",
    "estimatedDurationSec",
  ],
};

function renderPrompt(
  input: Required<
    Pick<KoseiAnimationScriptInput, "topic" | "targetDurationSec" | "targetSceneCount">
  > & { era: string; research: string },
): string {
  const tpl = fs.readFileSync(promptPath("script-routine", "kosei-animation"), "utf-8");
  return tpl
    .replace(/\{\{topic\}\}/g, input.topic)
    .replace(/\{\{era\}\}/g, input.era)
    .replace(/\{\{research\}\}/g, input.research)
    .replace(/\{\{target_duration_sec\}\}/g, String(input.targetDurationSec))
    .replace(/\{\{target_scene_count\}\}/g, String(input.targetSceneCount));
}

function readingsArrayToMap(
  arr: Array<{ term: string; reading: string }> | undefined,
): Record<string, string> {
  if (!Array.isArray(arr)) return {};
  const out: Record<string, string> = {};
  for (const { term, reading } of arr) {
    if (term && reading && !out[term]) out[term] = reading;
  }
  return out;
}

export async function generateKoseiAnimationScript(
  input: KoseiAnimationScriptInput,
): Promise<KoseiAnimationScriptResult> {
  const targetDurationSec = input.targetDurationSec ?? 40;
  const targetSceneCount = input.targetSceneCount ?? 8;
  const era = input.era ?? "指定なし";
  const research =
    input.researchMd?.trim() ||
    "（リサーチ資料なし。既知の範囲で慎重に、断定しすぎず書くこと）";

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt({
    topic: input.topic,
    era,
    research,
    targetDurationSec,
    targetSceneCount,
  });

  const response = await ai.models.generateContent({
    model: config.gemini.scriptModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.65,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty kosei-animation script response");

  const raw = JSON.parse(text) as {
    narration: string;
    hook: string;
    title: { top: string; bottom: string };
    body: string;
    closing: string;
    keyTerms?: string[];
    readings?: Array<{ term: string; reading: string }>;
    estimatedDurationSec?: number;
  };

  return {
    script: {
      topic: input.topic,
      era: input.era ?? null,
      hook: raw.hook,
      title: raw.title,
      narration: raw.narration,
      body: raw.body,
      closing: raw.closing,
      keyTerms: raw.keyTerms ?? [],
      readings: readingsArrayToMap(raw.readings),
      estimatedDurationSec: raw.estimatedDurationSec ?? targetDurationSec,
      targetSceneCount,
    },
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.scriptModel,
    },
  };
}
