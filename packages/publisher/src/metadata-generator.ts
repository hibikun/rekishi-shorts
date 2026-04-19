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

/**
 * ライセンスが帰属表記（attribution）を法的に要求するかを判定する。
 * - Public Domain / PD / CC0 系: 不要
 * - CC-BY / CC-BY-SA / CC-BY-ND / CC-BY-NC 系: 必要
 * - Gemini（AI生成）: 不要（YouTube Studio 側で「改変コンテンツ」開示で対応）
 * - 不明: 表記しない（保守運用を優先。疑義があれば元の画像を使わない運用に倒す）
 */
function requiresAttribution(license: string | undefined): boolean {
  if (!license) return false;
  const l = license.toLowerCase();
  if (l.includes("public domain") || l === "pd" || l.includes("cc0") || l.includes("cc-0")) return false;
  if (l.includes("gemini")) return false;
  if (l.includes("cc-by") || l.includes("cc by")) return true;
  return false;
}

function buildAttributionBlock(images: ImageAsset[]): string {
  const requiring = images.filter((i) => i.source === "wikimedia" && requiresAttribution(i.license));
  if (requiring.length === 0) return "";

  const lines: string[] = [];
  lines.push("---");
  lines.push("### 画像出典（Wikimedia Commons）");
  const seen = new Set<string>();
  for (const a of requiring) {
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
  const body = attribution ? `${raw.description}\n\n${attribution}` : raw.description;
  const description = ensureShortsInDescription(body).slice(0, 5000);
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
