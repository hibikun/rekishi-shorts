import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";

export interface UkiyoeScriptInput {
  topic: string;
  era?: string;
  /** 任意：手元の research.md を流し込む */
  researchMd?: string;
  /** 試作短尺用。既定 20 秒 */
  targetDurationSec?: number;
  /** 既定 4 シーン（試作） */
  targetSceneCount?: number;
}

export interface UkiyoeScript {
  topic: string;
  era: string | null;
  hook: string;
  narration: string;
  keyTerms: string[];
  readings: Record<string, string>;
  estimatedDurationSec: number;
  targetSceneCount: number;
}

export interface UkiyoeScriptResult {
  script: UkiyoeScript;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    narration: { type: Type.STRING },
    hook: { type: Type.STRING },
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
  required: ["narration", "hook", "keyTerms", "estimatedDurationSec"],
};

function renderPrompt(input: Required<Pick<UkiyoeScriptInput, "topic" | "targetDurationSec" | "targetSceneCount">> & { era: string; research: string }): string {
  const tpl = fs.readFileSync(promptPath("script-routine", "ukiyoe"), "utf-8");
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

export async function generateUkiyoeScript(
  input: UkiyoeScriptInput,
): Promise<UkiyoeScriptResult> {
  const targetDurationSec = input.targetDurationSec ?? 20;
  const targetSceneCount = input.targetSceneCount ?? 4;
  const era = input.era ?? "指定なし";
  const research = input.researchMd?.trim() || "（リサーチ資料なし — 自身の知識で慎重に書くこと）";

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
      temperature: 0.7,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty ukiyoe script response");

  const raw = JSON.parse(text) as {
    narration: string;
    hook: string;
    keyTerms?: string[];
    readings?: Array<{ term: string; reading: string }>;
    estimatedDurationSec?: number;
  };

  const script: UkiyoeScript = {
    topic: input.topic,
    era: input.era ?? null,
    hook: raw.hook,
    narration: raw.narration,
    keyTerms: raw.keyTerms ?? [],
    readings: readingsArrayToMap(raw.readings),
    estimatedDurationSec: raw.estimatedDurationSec ?? targetDurationSec,
    targetSceneCount,
  };

  return {
    script,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.scriptModel,
    },
  };
}
