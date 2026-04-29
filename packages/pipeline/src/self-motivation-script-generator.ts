import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import {
  SelfMotivationChapterSchema,
  SelfMotivationScriptSchema,
  type SelfMotivationChapter,
  type SelfMotivationScript,
  type SelfMotivationTopic,
} from "@rekishi/shared";
import { z } from "zod";
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

// ────────────────────────────────────────────────────────────
// 部分再生成: Method-Teaching 章のみを書き直す
// ────────────────────────────────────────────────────────────

function renderRegeneratePrompt(args: {
  topic: SelfMotivationTopic;
  openingHook: string;
  chapter1: SelfMotivationChapter;
  targets: SelfMotivationChapter[];
  researchMd: string;
  youtubeRefs: YoutubeReferenceForPrompt[];
}): string {
  const tpl = fs.readFileSync(
    promptFilePath("regenerate-method-chapters"),
    "utf-8",
  );
  const targetSection = args.targets
    .map(
      (c, i) =>
        `### 対象 ${i + 1}: 「${c.title}」 (テーマ: ${c.title.replace(/[「」]/g, "")})\n` +
          `現状の本文 (参考、これを書き直す):\n${c.narrationParagraphs.join("\n")}`,
    )
    .join("\n\n---\n\n");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, args.topic.title)
    .replace(/\{\{topic\.subject\}\}/g, args.topic.subject)
    .replace(/\{\{openingHook\}\}/g, args.openingHook)
    .replace(/\{\{chapter1\.title\}\}/g, args.chapter1.title)
    .replace(
      /\{\{chapter1\.body\}\}/g,
      args.chapter1.narrationParagraphs.join("\n"),
    )
    .replace(/\{\{targetChapters\}\}/g, targetSection)
    .replace(/\{\{chapterCount\}\}/g, String(args.targets.length))
    .replace(
      /\{\{research\}\}/g,
      args.researchMd.trim() || "（リサーチ資料なし）",
    )
    .replace(
      /\{\{youtubeReferences\}\}/g,
      formatYoutubeReferences(args.youtubeRefs),
    );
}

const regenerateResponseSchema = {
  type: Type.OBJECT,
  properties: {
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
  },
  required: ["chapters"],
};

const RegenerateChaptersOutputSchema = z.object({
  chapters: z.array(SelfMotivationChapterSchema).min(1),
});

export interface RegenerateMethodChaptersResult {
  /** 全章マージ済みの新しい script */
  script: SelfMotivationScript;
  /** 差し替えた章だけ */
  regenerated: SelfMotivationChapter[];
  usage: { inputTokens: number; outputTokens: number; model: string };
}

/**
 * 既存 script の指定範囲の章 (Method-Teaching) だけを再生成して差し替える。
 *
 * @param fromIndex 0-indexed (含む)
 * @param toIndex   0-indexed (含む)
 *
 * 第 1 章 (Myth-Busting)・openingHook・closingCta は **触らない**。
 */
export async function regenerateMethodChapters(args: {
  existingScript: SelfMotivationScript;
  fromIndex: number;
  toIndex: number;
  researchMd: string;
  youtubeRefs?: YoutubeReferenceForPrompt[];
}): Promise<RegenerateMethodChaptersResult> {
  const {
    existingScript,
    fromIndex,
    toIndex,
    researchMd,
    youtubeRefs = [],
  } = args;
  if (fromIndex < 1) {
    throw new Error(
      "fromIndex は 1 以上にしてください (第 1 章 Myth-Busting は触れません)",
    );
  }
  if (toIndex < fromIndex) {
    throw new Error("toIndex は fromIndex 以上にしてください");
  }
  if (toIndex >= existingScript.chapters.length) {
    throw new Error(
      `toIndex=${toIndex} が章数 (${existingScript.chapters.length}) を超えています`,
    );
  }
  const chapter1 = existingScript.chapters[0];
  if (!chapter1) throw new Error("既存 script に第 1 章がありません");
  const targets = existingScript.chapters.slice(fromIndex, toIndex + 1);

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderRegeneratePrompt({
    topic: existingScript.topic,
    openingHook: existingScript.openingHook,
    chapter1,
    targets,
    researchMd,
    youtubeRefs,
  });

  const response = await ai.models.generateContent({
    model: config.gemini.scriptModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: regenerateResponseSchema,
      temperature: 0.8,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty regenerate response");

  const raw = JSON.parse(text) as unknown;
  const parsed = RegenerateChaptersOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `regenerate JSON が schema に合致しません: ${parsed.error.message}`,
    );
  }
  if (parsed.data.chapters.length !== targets.length) {
    throw new Error(
      `Gemini が ${targets.length} 章を返すはずが ${parsed.data.chapters.length} 章でした`,
    );
  }

  const newChapters = [...existingScript.chapters];
  parsed.data.chapters.forEach((c, i) => {
    newChapters[fromIndex + i] = c;
  });
  const newScript: SelfMotivationScript = {
    ...existingScript,
    chapters: newChapters,
  };

  return {
    script: newScript,
    regenerated: parsed.data.chapters,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.scriptModel,
    },
  };
}
