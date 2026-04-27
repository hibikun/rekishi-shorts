import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export interface GenerateImageOptions {
  /** 参照画像のパス。同一キャラを別角度・別シーンで生成したい時に渡す。 */
  referenceImages?: string[];
  /** デフォルトの 9:16 サフィックスを付けるか。既定 true。 */
  appendAspectSuffix?: boolean;
}

function mimeTypeForPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/**
 * Nano Banana (Gemini 3.1 Flash Image) で画像を生成し、destPath に保存する。
 * `referenceImages` を渡すとキャラ一貫性を保った別角度/別シーンを生成できる。
 */
export async function generateImage(
  prompt: string,
  destPath: string,
  options: GenerateImageOptions = {},
): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const appendAspect = options.appendAspectSuffix ?? true;
  const fullPrompt = appendAspect
    ? `${prompt}\n\nAspect ratio: 9:16 (vertical). High quality, suitable for a short-form educational video.`
    : prompt;

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];
  for (const ref of options.referenceImages ?? []) {
    const buf = await fs.readFile(ref);
    parts.push({
      inlineData: {
        mimeType: mimeTypeForPath(ref),
        data: buf.toString("base64"),
      },
    });
  }
  parts.push({ text: fullPrompt });

  const response = await ai.models.generateContent({
    model: config.gemini.imageModel,
    contents: parts,
  });

  const responseParts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of responseParts) {
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
