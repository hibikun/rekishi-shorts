import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import {
  SelfMotivationScriptSchema,
  type SelfMotivationScript,
  type SelfMotivationTopic,
} from "@rekishi/shared";
import { config } from "./config.js";
import { promptFilePath } from "./self-motivation-paths.js";

export interface YoutubeReferenceForPrompt {
  videoId: string;
  url: string;
  title?: string;
  note?: string;
  markdown: string;
}

function formatYoutubeReferences(refs: YoutubeReferenceForPrompt[]): string {
  if (refs.length === 0) {
    return "（参考 YouTube 動画なし — リサーチ資料のみで構成すること）";
  }
  return refs
    .map((r, i) => {
      const headerLines = [
        `### 参考動画 ${i + 1}: ${r.title ?? r.videoId}`,
        `- URL: ${r.url}`,
      ];
      if (r.note) headerLines.push(`- 参照理由メモ: ${r.note}`);
      return `${headerLines.join("\n")}\n\n${r.markdown.trim()}\n`;
    })
    .join("\n---\n\n");
}

function renderPrompt(
  topic: SelfMotivationTopic,
  researchMd: string,
  youtubeRefs: YoutubeReferenceForPrompt[],
): string {
  const tpl = fs.readFileSync(promptFilePath("script"), "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(
      /\{\{research\}\}/g,
      researchMd.trim() ||
        "（リサーチ資料なし — 自身の知識で慎重に書くこと）",
    )
    .replace(/\{\{youtubeReferences\}\}/g, formatYoutubeReferences(youtubeRefs));
}

// 注意: topic は Gemini に返させない。生成後に jobTopic を強制注入する。
// 過去に enum 不整合 (target/format) が原因で parse が落ちた経験から、
// 「呼び出し側が topic の真実値を持っているなら Gemini に書かせる必要がない」という方針。
const responseSchema = {
  type: Type.OBJECT,
  properties: {
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
  topic: SelfMotivationTopic,
  researchMd: string,
  youtubeRefs: YoutubeReferenceForPrompt[] = [],
): Promise<GenerateScriptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(topic, researchMd, youtubeRefs);

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

  // Gemini には topic を返させていない (responseSchema から除外済み) ので、
  // パース前に呼び出し側の topic を強制注入する。
  // これにより SelfMotivationScriptSchema の topic 必須制約も満たせる。
  const rawJson = JSON.parse(text) as Record<string, unknown>;
  const merged = { ...rawJson, topic };
  const parsed = SelfMotivationScriptSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(
      `script JSON が schema に合致しません: ${parsed.error.message}`,
    );
  }
  const script: SelfMotivationScript = parsed.data;

  return {
    script,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.scriptModel,
    },
  };
}
