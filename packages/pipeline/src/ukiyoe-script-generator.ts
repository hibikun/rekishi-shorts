import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";

export type UkiyoeScriptMode = "routine" | "life";

export interface UkiyoeScriptInput {
  topic: string;
  era?: string;
  /** 任意：手元の research.md を流し込む */
  researchMd?: string;
  /** 指定時は尺の目安を固定する。未指定なら台本に任せる。 */
  targetDurationSec?: number;
  /** 指定時はシーン数を固定する。未指定なら台本から自動推定する。 */
  targetSceneCount?: number;
  /** プロンプトの軸。"routine"=○○の1日 / "life"=○○の一生。既定 "routine" */
  mode?: UkiyoeScriptMode;
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

const AUTO_TARGET_SCENE_COUNT_LABEL =
  "台本の自然な区切りに応じて決める（目安 8〜16 シーン）";
const AUTO_TARGET_DURATION_LABEL =
  "40〜80 秒程度。題材の情報量とテンポを優先する";

function renderPrompt(input: {
  topic: string;
  targetDurationLabel: string;
  targetSceneCountLabel: string;
  era: string;
  research: string;
  mode: UkiyoeScriptMode;
}): string {
  const promptName = input.mode === "life" ? "script-life" : "script-routine";
  const tpl = fs.readFileSync(promptPath(promptName, "ukiyoe"), "utf-8");
  return tpl
    .replace(/\{\{topic\}\}/g, input.topic)
    .replace(/\{\{era\}\}/g, input.era)
    .replace(/\{\{research\}\}/g, input.research)
    .replace(/\{\{target_duration_sec\}\}/g, input.targetDurationLabel)
    .replace(/\{\{target_scene_count\}\}/g, input.targetSceneCountLabel);
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

function normalizedLength(s: string): number {
  return s.replace(/[\s　、。．，「」『』（）()！？!?・…—\-]/g, "").length;
}

function splitNarrationLines(narration: string): string[] {
  return narration
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitNarrationSentences(narration: string): string[] {
  return narration
    .match(/[^。！？!?\n]+[。！？!?]?/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [];
}

function mergeShortBeats(beats: string[]): string[] {
  const merged: string[] = [];
  let pending = "";
  for (const beat of beats) {
    const next = pending ? `${pending}${beat}` : beat;
    if (!pending || normalizedLength(next) <= 32 || normalizedLength(pending) < 14) {
      pending = next;
      continue;
    }
    merged.push(pending);
    pending = beat;
  }
  if (pending) merged.push(pending);
  return merged;
}

export function inferUkiyoeSceneCount(
  narration: string,
  estimatedDurationSec?: number,
): number {
  const lines = splitNarrationLines(narration);
  const beats =
    lines.length > 1
      ? lines
      : mergeShortBeats(splitNarrationSentences(narration));
  const countFromText = beats.length > 0 ? beats.length : undefined;
  const countFromDuration =
    estimatedDurationSec && Number.isFinite(estimatedDurationSec)
      ? Math.ceil(estimatedDurationSec / 5)
      : undefined;
  const raw = countFromText ?? countFromDuration ?? 12;
  return Math.min(16, Math.max(2, raw));
}

export async function generateUkiyoeScript(
  input: UkiyoeScriptInput,
): Promise<UkiyoeScriptResult> {
  const fixedSceneCount = input.targetSceneCount;
  const targetDurationSec =
    input.targetDurationSec ?? (fixedSceneCount !== undefined ? fixedSceneCount * 5 : undefined);
  const era = input.era ?? "指定なし";
  const research = input.researchMd?.trim() || "（リサーチ資料なし — 自身の知識で慎重に書くこと）";
  const mode: UkiyoeScriptMode = input.mode ?? "routine";

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt({
    topic: input.topic,
    era,
    research,
    targetDurationLabel:
      targetDurationSec !== undefined ? `${targetDurationSec} 秒` : AUTO_TARGET_DURATION_LABEL,
    targetSceneCountLabel:
      fixedSceneCount !== undefined
        ? `${fixedSceneCount} シーン`
        : AUTO_TARGET_SCENE_COUNT_LABEL,
    mode,
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
  const estimatedDurationSec =
    raw.estimatedDurationSec ?? targetDurationSec ?? undefined;
  const targetSceneCount =
    fixedSceneCount ?? inferUkiyoeSceneCount(raw.narration, estimatedDurationSec);

  const script: UkiyoeScript = {
    topic: input.topic,
    era: input.era ?? null,
    hook: raw.hook,
    narration: raw.narration,
    keyTerms: raw.keyTerms ?? [],
    readings: readingsArrayToMap(raw.readings),
    estimatedDurationSec: estimatedDurationSec ?? targetSceneCount * 5,
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
