import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";

export interface ResearchSource {
  uri: string;
  title?: string;
  domain?: string;
}

export interface ResearchResult {
  markdown: string;
  sources: ResearchSource[];
  queries: string[];
  usage: { inputTokens: number; outputTokens: number; model: string };
}

/**
 * リサーチプロンプトに展開できる最小構造。
 * rekishi 系の `Topic` は `target` / `era` を持つが、self-motivation 系は持たない。
 * チャンネル間で再利用するためにここでは構造的型として緩く受ける。
 */
export interface ResearchTopic {
  title: string;
  subject: string;
  era?: string;
  target?: string;
}

export type ResearchMode = "routine" | "life";

export interface ResearchOptions {
  mode?: ResearchMode;
}

function renderPrompt(topic: ResearchTopic, mode: ResearchMode): string {
  const primaryName = mode === "life" ? "research-life" : "research";
  const primaryPath = promptPath(primaryName);
  const resolvedPath = fs.existsSync(primaryPath)
    ? primaryPath
    : promptPath("research");
  const tpl = fs.readFileSync(resolvedPath, "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.era\}\}/g, topic.era ?? "指定なし")
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(/\{\{topic\.target\}\}/g, topic.target ?? "汎用");
}

export async function generateResearch(
  topic: ResearchTopic,
  options: ResearchOptions = {},
): Promise<ResearchResult> {
  const mode = options.mode ?? "routine";
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(topic, mode);

  const response = await ai.models.generateContent({
    model: config.gemini.researchModel,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.4,
    },
  });

  const markdown = response.text ?? "";
  if (!markdown) throw new Error("Gemini returned empty research response");

  const grounding = response.candidates?.[0]?.groundingMetadata;
  const sources: ResearchSource[] = (grounding?.groundingChunks ?? [])
    .map((chunk) => chunk.web)
    .filter((web): web is { uri: string; title?: string; domain?: string } => !!web?.uri)
    .map((web) => ({ uri: web.uri, title: web.title, domain: web.domain }));
  const queries = grounding?.webSearchQueries ?? [];

  return {
    markdown,
    sources,
    queries,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.researchModel,
    },
  };
}
