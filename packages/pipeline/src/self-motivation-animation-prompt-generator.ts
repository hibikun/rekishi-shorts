import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import type {
  SelfMotivationScene,
  SelfMotivationScript,
  SelfMotivationTopic,
} from "@rekishi/shared";
import { config } from "./config.js";
import { promptFilePath } from "./self-motivation-paths.js";

function renderPrompt(
  scene: SelfMotivationScene,
  script: SelfMotivationScript,
  topic: SelfMotivationTopic,
  userDirection: string,
): string {
  const tpl = fs.readFileSync(promptFilePath("animation-prompt"), "utf-8");
  const chapterTitle =
    script.chapters[scene.chapterIndex]?.title ?? "（章未指定）";
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{chapter\.title\}\}/g, chapterTitle)
    .replace(/\{\{scene\.narration\}\}/g, scene.narration)
    .replace(
      /\{\{scene\.imagePromptEn\}\}/g,
      (scene.imagePromptEn ?? "").trim() || "(image prompt unavailable)",
    )
    .replace(/\{\{userDirection\}\}/g, userDirection || "（指示なし）");
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    videoPromptEn: { type: Type.STRING },
    motionSummaryJa: { type: Type.STRING },
  },
  required: ["videoPromptEn", "motionSummaryJa"],
};

export interface SelfMotivationAnimationPromptResult {
  videoPromptEn: string;
  motionSummaryJa: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

/**
 * SelfMotivation シーンの narration + 元画像プロンプトから Seedance 用の英語プロンプトを生成する。
 * Gemini structured output で `{ videoPromptEn, motionSummaryJa }` を返させる。
 */
export async function generateAnimationPromptForScene(
  scene: SelfMotivationScene,
  script: SelfMotivationScript,
  topic: SelfMotivationTopic,
  userDirection = "",
): Promise<SelfMotivationAnimationPromptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(scene, script, topic, userDirection);

  const response = await ai.models.generateContent({
    model: config.gemini.sceneModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.7,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty animation prompt response");

  const raw = JSON.parse(text) as {
    videoPromptEn?: unknown;
    motionSummaryJa?: unknown;
  };
  if (typeof raw.videoPromptEn !== "string" || !raw.videoPromptEn.trim()) {
    throw new Error("videoPromptEn is missing or empty");
  }

  return {
    videoPromptEn: raw.videoPromptEn.trim(),
    motionSummaryJa:
      typeof raw.motionSummaryJa === "string" ? raw.motionSummaryJa.trim() : "",
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.sceneModel,
    },
  };
}
