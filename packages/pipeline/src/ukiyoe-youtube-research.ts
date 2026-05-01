import { GoogleGenAI, createPartFromUri } from "@google/genai";
import fs from "node:fs";
import { promptPath, channelSubjectDefault } from "@rekishi/shared/channel";
import { type UkiyoeTopic } from "@rekishi/shared";
import { config } from "./config.js";

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export interface UkiyoeYoutubeTranscribeResult {
  markdown: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") {
    return null;
  }

  const v = url.searchParams.get("v");
  if (v && YOUTUBE_VIDEO_ID_PATTERN.test(v)) return v;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const head = segments[0] ?? "";
    const id = segments[1] ?? "";
    if (
      (head === "embed" ||
        head === "shorts" ||
        head === "live" ||
        head === "v") &&
      YOUTUBE_VIDEO_ID_PATTERN.test(id)
    ) {
      return id;
    }
  }
  return null;
}

export function normalizeYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function generateYoutubeRefId(): string {
  return Math.random().toString(36).slice(2, 10).padStart(8, "0");
}

function renderPrompt(topic: UkiyoeTopic, videoUrl: string, note?: string): string {
  const tpl = fs.readFileSync(promptPath("youtube-research", "ukiyoe"), "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.era\}\}/g, topic.era?.trim() || "指定なし")
    .replace(/\{\{topic\.mode\}\}/g, topic.mode)
    .replace(/\{\{topic\.subject\}\}/g, channelSubjectDefault("ukiyoe"))
    .replace(/\{\{video\.url\}\}/g, videoUrl)
    .replace(/\{\{video\.note\}\}/g, note?.trim() || "（なし）");
}

export async function transcribeUkiyoeYoutubeVideo(args: {
  topic: UkiyoeTopic;
  videoId: string;
  note?: string;
}): Promise<UkiyoeYoutubeTranscribeResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const url = normalizeYoutubeWatchUrl(args.videoId);
  const prompt = renderPrompt(args.topic, url, args.note);

  const response = await ai.models.generateContent({
    model: config.gemini.researchModel,
    contents: [
      {
        role: "user",
        parts: [createPartFromUri(url, "video/youtube"), { text: prompt }],
      },
    ],
    config: {
      temperature: 0.3,
    },
  });

  const markdown = response.text ?? "";
  if (!markdown.trim()) {
    throw new Error(
      "Gemini が YouTube 動画から参考分析を返さなかった (非公開 / 地域制限 / 年齢制限の可能性)",
    );
  }

  return {
    markdown,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.researchModel,
    },
  };
}
