import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import {
  SelfMotivationScriptSchema,
  type SelfMotivationScript,
  type Topic,
} from "@rekishi/shared";
import { config } from "./config.js";
import { promptFilePath } from "./self-motivation-paths.js";

function renderPrompt(topic: Topic, researchMd: string): string {
  const tpl = fs.readFileSync(promptFilePath("script"), "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(
      /\{\{research\}\}/g,
      researchMd.trim() ||
        "（リサーチ資料なし — 自身の知識で慎重に書くこと）",
    );
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    topic: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        era: { type: Type.STRING },
        subject: { type: Type.STRING },
        target: { type: Type.STRING },
        format: { type: Type.STRING },
      },
      required: ["title", "subject", "target", "format"],
    },
    openingTitle: {
      type: Type.OBJECT,
      properties: {
        top: { type: Type.STRING },
        bottom: { type: Type.STRING },
      },
      required: ["top", "bottom"],
    },
    openingHook: { type: Type.STRING },
    chapters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          narrationParagraphs: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["title", "narrationParagraphs"],
      },
    },
    closingCta: { type: Type.STRING },
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
    "topic",
    "openingTitle",
    "openingHook",
    "chapters",
    "closingCta",
    "estimatedDurationSec",
  ],
};

export interface GenerateScriptResult {
  script: SelfMotivationScript;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export async function generateSelfMotivationScript(
  topic: Topic,
  researchMd: string,
): Promise<GenerateScriptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(topic, researchMd);

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

  const parsed = SelfMotivationScriptSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `script JSON が schema に合致しません: ${parsed.error.message}`,
    );
  }

  // topic は必ず入力をオーバーライド（モデルが取りこぼす場合がある）
  const script: SelfMotivationScript = { ...parsed.data, topic };

  return {
    script,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.scriptModel,
    },
  };
}
