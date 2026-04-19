import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderPlan, ImageAsset } from "@rekishi/shared";
import { config } from "./config.js";
import { YouTubeMetadataSchema, type YouTubeMetadata } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_PATH = path.resolve(__dirname, "../prompts/youtube-metadata.md");

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["title", "description", "tags"],
};

function renderPrompt(plan: RenderPlan): string {
  const tpl = fs.readFileSync(PROMPT_PATH, "utf-8");
  const topic = plan.script.topic;
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.era\}\}/g, topic.era ?? "指定なし")
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(/\{\{topic\.target\}\}/g, topic.target)
    .replace(/\{\{topic\.format\}\}/g, topic.format)
    .replace(/\{\{keyTerms\}\}/g, plan.script.keyTerms.join("、"))
    .replace(/\{\{narration\}\}/g, plan.script.narration);
}

function buildAttributionBlock(images: ImageAsset[]): string {
  const wiki = images.filter((i) => i.source === "wikimedia");
  const generated = images.filter((i) => i.source === "generated");

  const lines: string[] = [];
  lines.push("---");
  if (wiki.length > 0) {
    lines.push("### 画像出典（Wikimedia Commons）");
    // 同じ sourceUrl の重複を除去
    const seen = new Set<string>();
    for (const a of wiki) {
      const key = a.sourceUrl ?? a.attribution ?? a.path;
      if (seen.has(key)) continue;
      seen.add(key);
      const attribution = a.attribution ?? "Wikimedia Commons";
      const license = a.license ? ` (${a.license})` : "";
      if (a.sourceUrl) {
        lines.push(`- ${attribution}${license}: ${a.sourceUrl}`);
      } else {
        lines.push(`- ${attribution}${license}`);
      }
    }
  }
  if (generated.length > 0) {
    lines.push("");
    lines.push("### 生成画像");
    lines.push(`本動画には AI で生成した画像 ${generated.length} 枚を含みます (Google Gemini)。`);
  }
  return lines.join("\n");
}

function ensureShortsTag(title: string): string {
  if (/#Shorts/i.test(title)) return title;
  const joiner = title.endsWith(" ") ? "" : " ";
  return `${title}${joiner}#Shorts`.slice(0, 100);
}

function ensureShortsInDescription(description: string): string {
  if (/#Shorts/i.test(description)) return description;
  return `${description}\n\n#Shorts`;
}

function capTags(tags: string[], maxTotalChars = 480): string[] {
  const out: string[] = [];
  let total = 0;
  for (const raw of tags) {
    const t = raw.trim();
    if (!t) continue;
    const len = t.length + (out.length > 0 ? 1 : 0);
    if (total + len > maxTotalChars) break;
    out.push(t);
    total += len;
  }
  return out;
}

export interface MetadataGenerationResult {
  metadata: YouTubeMetadata;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export async function generateYouTubeMetadata(plan: RenderPlan): Promise<MetadataGenerationResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(plan);

  const response = await ai.models.generateContent({
    model: config.gemini.metadataModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.7,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty metadata response");

  const raw = JSON.parse(text) as { title: string; description: string; tags: string[] };

  const title = ensureShortsTag(raw.title);
  const attribution = buildAttributionBlock(plan.images);
  const description = ensureShortsInDescription(`${raw.description}\n\n${attribution}`).slice(0, 5000);
  const tags = capTags(raw.tags);

  const metadata = YouTubeMetadataSchema.parse({
    title,
    description,
    tags,
    categoryId: "27",
    privacyStatus: "public",
    containsSyntheticMedia: true,
  });

  return {
    metadata,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.metadataModel,
    },
  };
}
