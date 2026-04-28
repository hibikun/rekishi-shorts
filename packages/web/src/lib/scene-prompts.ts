import { GoogleGenAI } from "@google/genai";
import { readFile } from "node:fs/promises";
import path from "node:path";

const GEMINI_TEXT_MODEL =
  process.env.GEMINI_SCENE_MODEL ?? "gemini-3.1-flash-lite-preview";

/**
 * Gemini Vision で画像の中身を日本語で説明させる。
 *
 * 失敗時は null を返す（呼び出し側で適切にハンドリング）。
 */
export async function describeImageWithVision(
  imageAbsPath: string,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[scene-prompts] GEMINI_API_KEY not set");
    return null;
  }

  const buf = await readFile(imageAbsPath);
  const ext = path.extname(imageAbsPath).toLowerCase();
  const mimeType =
    ext === ".webp"
      ? "image/webp"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : "image/png";

  const instruction = `この画像に描かれているものを日本語で簡潔に説明してください。

含める要素:
- キャラクター/被写体（ポーズ・表情）
- 背景・小道具
- 色味・雰囲気
- 構図（寄り/引き、視点）

ルール:
- 100〜200字
- 描写文のみ。前置きや注釈は不要
- 「〜が写っている」「〜な雰囲気」のような客観描写で書く`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [
        {
          inlineData: {
            mimeType,
            data: buf.toString("base64"),
          },
        },
        { text: instruction },
      ],
    });
    const part = res.candidates?.[0]?.content?.parts?.[0] as
      | { text?: string }
      | undefined;
    return part?.text?.trim() ?? null;
  } catch (err) {
    console.error("[scene-prompts] vision describe failed:", err);
    return null;
  }
}

/**
 * 画像内容（instruction）+ シーン文脈から、Seedance V1 Lite img2video 用の
 * subtle motion プロンプトを Gemini で派生させる。
 */
export async function deriveSeedancePrompt(opts: {
  instruction: string;
  beat: string;
  narration: string;
  assetKind: "character" | "broll";
  overlayText?: string | null;
}): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[scene-prompts] GEMINI_API_KEY not set");
    return null;
  }

  const styleGuide =
    opts.assetKind === "character"
      ? `The image shows the manabilab brand mascot — a humanoid figure with a pink brain-shaped head, flat 2D vector cartoon style, clean lines, pink and grey palette.

Motion rules:
- Keep the character's identity and pose stable; only add SUBTLE motion (small sway, gentle pulse on the brain glow, tiny floating particles, slow camera push-in).
- Always end with this exact sentence: "Maintain the original flat 2D vector cartoon style."`
      : `The image is an educational B-roll illustration with clean lines and a pink/grey palette.

Motion rules:
- Add SUBTLE motion appropriate to the visual concept (slow camera push-in, gentle ambient motion, tiny color pulses on key elements, soft shifts).
- End with a short style-preservation reminder appropriate to the look (e.g., "Maintain the original aesthetic.").`;

  const sysPrompt = `You write img2video animation prompts for ByteDance Seedance V1 Lite.
Output ONLY the seedance prompt itself — 2 to 3 short sentences, in English, ~80-180 words total. No JSON, no quotes, no preamble, no explanation.

${styleGuide}

Scene context:
- Beat: ${opts.beat}
- Narration (Japanese, for tone): "${opts.narration}"
- Image content (Japanese, what is in the image): ${opts.instruction}
${opts.overlayText ? `- Onscreen text overlay (will be added in post, image should leave headroom): "${opts.overlayText}"` : ""}

Now write the Seedance prompt:`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: sysPrompt,
    });
    const part = res.candidates?.[0]?.content?.parts?.[0] as
      | { text?: string }
      | undefined;
    return part?.text?.trim() ?? null;
  } catch (err) {
    console.error("[scene-prompts] seedance derivation failed:", err);
    return null;
  }
}
