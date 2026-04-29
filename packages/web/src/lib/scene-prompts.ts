import { GoogleGenAI, Type } from "@google/genai";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { UkiyoeActionTag } from "@rekishi/shared";

const GEMINI_TEXT_MODEL =
  process.env.GEMINI_SCENE_MODEL ?? "gemini-3.1-flash-lite-preview";

const ACTION_TAG_LABEL_JA: Record<UkiyoeActionTag, string> = {
  running_forward: "走る・疾走",
  eating_meal: "食事・口に運ぶ",
  drawing_sword: "剣を抜く・振る・斬る",
  walking_carrying: "歩く・荷を担ぐ",
  sleeping: "寝る・横たわる",
  crowd_cheering: "群衆・歓声・祭り",
  weather_dynamic: "雷雨・風・雪などの天候",
  still_subtle: "静的だが背景に微細な動き",
};

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

/**
 * manabilab の Seedance プロンプトを英語/日本語の bilingual で派生する。
 *
 * `deriveSeedancePrompt` の bilingual 版。Gemini に JSON で
 * `{ "en": "...", "ja": "..." }` を返させる。
 * Web UI 上で日本語編集→英訳のワークフローに乗せるための初期値生成に使う。
 */
export async function deriveBilingualSeedancePrompt(opts: {
  instruction: string;
  beat: string;
  narration: string;
  assetKind: "character" | "broll";
  overlayText?: string | null;
}): Promise<{ en: string; ja: string } | null> {
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

Output a JSON object with two fields:
- "en": the English Seedance prompt (2-3 sentences, ~80-180 words). No quotes, no preamble. This is sent to Seedance.
- "ja": a natural Japanese rewrite of the same motion description (2-3 sentences). NOT a literal translation — it should read like native Japanese motion description that a human editor can tweak and re-translate later.

${styleGuide}

Scene context:
- Beat: ${opts.beat}
- Narration (Japanese, for tone): "${opts.narration}"
- Image content (Japanese, what is in the image): ${opts.instruction}
${opts.overlayText ? `- Onscreen text overlay (will be added in post, image should leave headroom): "${opts.overlayText}"` : ""}

Now output the JSON:`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: sysPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            en: { type: Type.STRING },
            ja: { type: Type.STRING },
          },
          required: ["en", "ja"],
        },
      },
    });
    const text = res.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as { en?: string; ja?: string };
    if (!parsed.en?.trim() || !parsed.ja?.trim()) return null;
    return { en: parsed.en.trim(), ja: parsed.ja.trim() };
  } catch (err) {
    console.error("[scene-prompts] bilingual seedance derivation failed:", err);
    return null;
  }
}

export interface TranslateVideoPromptContext {
  channel: "ukiyoe" | "manabilab";
  /** 動画のトピック（ukiyoe）/ planのtitle (manabilab) */
  topic?: string;
  /** このシーンのナレーション。文脈翻訳の重要な手がかり。 */
  narration: string;
  /** manabilab の beat */
  beat?: string;
  /** ukiyoe の動勢タグ */
  actionTag?: UkiyoeActionTag;
  /** ukiyoe のカメラ固定指定 */
  cameraFixed?: boolean;
  /** manabilab の素材種別 */
  assetKind?: "character" | "broll";
  /** manabilab の overlay テキスト */
  overlayText?: string | null;
}

/**
 * 日本語のシーンプロンプトをコンテキストに沿って英訳して、
 * Seedance V1 Lite img2video 向けの英語プロンプトを生成する。
 *
 * 直訳ではなく、シーンの文脈（ナレーション・動勢タグ・素材種別）を踏まえて
 * Seedance が理解しやすい語彙に翻案する。
 */
export async function translateVideoPromptJaToEn(args: {
  ja: string;
  context: TranslateVideoPromptContext;
}): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[scene-prompts] GEMINI_API_KEY not set");
    return null;
  }

  const ja = args.ja.trim();
  if (!ja) return null;

  const ctx = args.context;
  const sysPrompt =
    ctx.channel === "ukiyoe"
      ? buildUkiyoeTranslationPrompt(ja, ctx)
      : buildManabilabTranslationPrompt(ja, ctx);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: sysPrompt,
    });
    const part = res.candidates?.[0]?.content?.parts?.[0] as
      | { text?: string }
      | undefined;
    const en = part?.text?.trim() ?? null;
    if (!en) return null;
    // 念のため周囲のクオート / 改行頭の余分な記号を削る
    return en.replace(/^["'`]+|["'`]+$/g, "").trim();
  } catch (err) {
    console.error("[scene-prompts] translation failed:", err);
    return null;
  }
}

function buildUkiyoeTranslationPrompt(
  ja: string,
  ctx: TranslateVideoPromptContext,
): string {
  const tag = ctx.actionTag ?? "still_subtle";
  const tagLabel = ACTION_TAG_LABEL_JA[tag];
  const cameraLine =
    ctx.cameraFixed === true
      ? "Camera is locked (no panning or zoom)."
      : ctx.cameraFixed === false
        ? "Camera may follow the motion subtly."
        : "Camera is controlled separately.";
  return `You translate Japanese motion descriptions into English Seedance V1 Lite img2video prompts for a Japanese ukiyo-e woodblock animation channel.

Style rules:
- Output ONLY the English prompt itself (2-3 sentences, ~60-150 words). No JSON, no quotes, no preamble, no explanation.
- Do NOT translate literally. Use natural Seedance vocabulary for ukiyo-e woodblock animation (figures, garments, sleeves, hair, banners, dust, mist, etc.).
- Do NOT include camera-direction words (push-in, pan, zoom, follow, tracking shot). Camera is controlled separately and prompt-side directives conflict with it.
- Maintain ukiyo-e (Japanese woodblock print) tone. Avoid photorealism cues like "cinematic lighting" or "depth of field".
- Describe the body, clothing, hair, props and surrounding elements (smoke, water, cloth, wind) concretely so the animation has texture.

Scene context:
${ctx.topic ? `- Topic: ${ctx.topic}` : ""}
- Narration (Japanese, for tone): "${ctx.narration}"
- Action tag: ${tag} (${tagLabel})
- ${cameraLine}

Japanese motion description to translate:
${ja}

English Seedance prompt:`;
}

function buildManabilabTranslationPrompt(
  ja: string,
  ctx: TranslateVideoPromptContext,
): string {
  const assetKind = ctx.assetKind ?? "character";
  const styleHint =
    assetKind === "character"
      ? `Subject is the manabilab brand mascot (humanoid with pink brain-shaped head, flat 2D vector cartoon style, pink/grey palette). Keep identity and pose stable; subtle motion only.
End with this exact sentence: "Maintain the original flat 2D vector cartoon style."`
      : `Subject is an educational B-roll illustration with clean lines and a pink/grey palette. Add subtle ambient motion appropriate to the visual concept.
End with: "Maintain the original aesthetic."`;

  return `You translate Japanese motion descriptions into English Seedance V1 Lite img2video prompts for the manabilab educational channel.

Style rules:
- Output ONLY the English prompt itself (2-3 sentences, ~80-180 words). No JSON, no quotes, no preamble, no explanation.
- Do NOT translate literally. Use natural Seedance vocabulary for educational 2D vector animation.
- ${styleHint}

Scene context:
${ctx.beat ? `- Beat: ${ctx.beat}` : ""}
- Narration (Japanese, for tone): "${ctx.narration}"
- Asset kind: ${assetKind}
${ctx.overlayText ? `- Onscreen text overlay (added in post, image leaves headroom): "${ctx.overlayText}"` : ""}

Japanese motion description to translate:
${ja}

English Seedance prompt:`;
}
