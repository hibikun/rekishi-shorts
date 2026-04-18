import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

/**
 * Nano Banana (Gemini 3.1 Flash Image) で画像を生成し、destPath に保存する。
 */
export async function generateImage(prompt: string, destPath: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const fullPrompt = `${prompt}\n\nAspect ratio: 9:16 (vertical). High quality, suitable for a short-form educational video.`;

  const response = await ai.models.generateContent({
    model: config.gemini.imageModel,
    contents: fullPrompt,
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
    if (inline?.data) {
      const buffer = Buffer.from(inline.data, "base64");
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, buffer);
      return;
    }
  }
  throw new Error("Nano Banana returned no image data");
}
