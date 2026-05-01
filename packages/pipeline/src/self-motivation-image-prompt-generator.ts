import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import type {
  SelfMotivationScene,
  SelfMotivationScript,
  SelfMotivationTopic,
} from "@rekishi/shared";
import { config } from "./config.js";
import { promptFilePath } from "./self-motivation-paths.js";

const CHARACTER_DIRECTIVE_WITH_REF =
  "## 重要: キャラクター一貫性\n\n参考画像 (reference image) が画像生成 API に同時に渡されます。プロンプト内に **「Use the same character (face, body shape, clothing, style, color palette) as in the provided reference image. The character must be visually identical to the reference across all scenes.」** という旨を必ず英語で含めてください。被写体は reference のキャラを軸に構図を組み立てる。";

function renderPrompt(
  scene: SelfMotivationScene,
  script: SelfMotivationScript,
  topic: SelfMotivationTopic,
  userDirection: string,
  hasCharacterReference: boolean,
): string {
  const tpl = fs.readFileSync(promptFilePath("image-prompt"), "utf-8");
  const chapterTitle =
    script.chapters[scene.chapterIndex]?.title ?? "（章未指定）";
  return tpl
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{chapter\.title\}\}/g, chapterTitle)
    .replace(/\{\{scene\.narration\}\}/g, scene.narration)
    .replace(/\{\{userDirection\}\}/g, userDirection || "（指示なし）")
    .replace(
      /\{\{characterDirective\}\}/g,
      hasCharacterReference ? CHARACTER_DIRECTIVE_WITH_REF : "",
    );
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    imagePromptEn: { type: Type.STRING },
    summaryJa: { type: Type.STRING },
  },
  required: ["imagePromptEn", "summaryJa"],
};

export interface SelfMotivationImagePromptResult {
  imagePromptEn: string;
  summaryJa: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export async function generateImagePromptForScene(
  scene: SelfMotivationScene,
  script: SelfMotivationScript,
  topic: SelfMotivationTopic,
  userDirection = "",
  hasCharacterReference = false,
): Promise<SelfMotivationImagePromptResult> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt(
    scene,
    script,
    topic,
    userDirection,
    hasCharacterReference,
  );

  const response = await ai.models.generateContent({
    model: config.gemini.sceneModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.8,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty image prompt response");

  const raw = JSON.parse(text) as {
    imagePromptEn?: unknown;
    summaryJa?: unknown;
  };
  if (typeof raw.imagePromptEn !== "string" || !raw.imagePromptEn.trim()) {
    throw new Error("imagePromptEn is missing or empty");
  }

  return {
    imagePromptEn: raw.imagePromptEn.trim(),
    summaryJa: typeof raw.summaryJa === "string" ? raw.summaryJa.trim() : "",
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.sceneModel,
    },
  };
}
