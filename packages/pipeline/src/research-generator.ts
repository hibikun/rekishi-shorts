import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import { type Topic } from "@rekishi/shared";
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

function renderPrompt(topic: Topic): string {
  const tpl = fs.readFileSync(promptPath("research"), "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.era\}\}/g, topic.era ?? "指定なし")
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(/\{\{topic\.target\}\}/g, topic.target);
}

export async function generateResearch(topic: Topic): Promise<ResearchResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(topic);

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
