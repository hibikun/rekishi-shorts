import { GoogleGenAI, createPartFromUri } from "@google/genai";
import fs from "node:fs";
import { type Topic } from "@rekishi/shared";
import { config } from "./config.js";
import {
  normalizeYoutubeWatchUrl,
  promptFilePath,
} from "./self-motivation-paths.js";

export interface YoutubeTranscribeResult {
  markdown: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

function renderPrompt(topic: Topic, videoUrl: string, note?: string): string {
  const tpl = fs.readFileSync(promptFilePath("youtube-research"), "utf-8");
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(/\{\{video\.url\}\}/g, videoUrl)
    .replace(/\{\{video\.note\}\}/g, note?.trim() ?? "（なし）");
}

/**
 * Gemini multimodal で YouTube 動画を視聴し、書き起こし＋構成分析を返す。
 *
 * 仕組み:
 * - Gemini 2.5+ は `fileData.fileUri` に YouTube URL を直接渡せる。
 * - 内部で動画を取得 → 音声認識 → 視覚＋音声の双方を踏まえて応答する。
 * - 公開動画のみ対象 (限定公開や年齢制限・地域制限ありは取得不可なことがある)。
 *
 * モデルは researchModel を流用する (Pro 系) — 長尺動画の理解には Pro が安定。
 */
export async function transcribeYoutubeVideo(args: {
  topic: Topic;
  videoId: string;
  note?: string;
}): Promise<YoutubeTranscribeResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const url = normalizeYoutubeWatchUrl(args.videoId);
  const prompt = renderPrompt(args.topic, url, args.note);

  const response = await ai.models.generateContent({
    model: config.gemini.researchModel,
    contents: [
      {
        role: "user",
        parts: [
          createPartFromUri(url, "video/youtube"),
          { text: prompt },
        ],
      },
    ],
    config: {
      temperature: 0.3,
    },
  });

  const markdown = response.text ?? "";
  if (!markdown.trim()) {
    throw new Error(
      "Gemini が YouTube 動画から書き起こしを返さなかった (動画が非公開 / 地域制限の可能性)",
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
