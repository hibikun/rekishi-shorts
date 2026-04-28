import { GoogleGenAI, Type } from "@google/genai";
import { config } from "./config.js";

const SYSTEM = `あなたは日本語の歴史トピックを英語の短い識別子（slug）に変換するアシスタントです。
出力は kebab-case（小文字英字とハイフンのみ）の slug 1 つだけ。
ローマ字化＋意訳を組み合わせ、ファイル名として扱える短い形にします。
最大 40 文字、最小 3 文字。`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    slug: { type: Type.STRING },
  },
  required: ["slug"],
};

function buildPrompt(title: string, era?: string): string {
  return `次のトピックを kebab-case の英語 slug に変換してください。
- 人名はローマ字（一般的な綴り）。例: 紫式部 → murasaki-shikibu、清少納言 → sei-shonagon
- 事件名はテーマ。例: 「ペリー来航」 → perry-arrival、「本能寺の変」 → honnoji-incident
- 比較や対立の構造があれば "vs" を挟む。例: 「紫式部と清少納言は仲が悪かった」 → murasaki-vs-sei-shonagon
- 長すぎるタイトルは要素 2-3 個に削減
- 半角英字・数字・ハイフンのみ。空白・大文字・記号・全角は禁止

トピック: ${title}
時代: ${era ?? "(指定なし)"}
`;
}

export async function generateSlug(title: string, era?: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const response = await ai.models.generateContent({
    model: config.gemini.sceneModel,
    contents: [
      { role: "user", parts: [{ text: SYSTEM + "\n\n" + buildPrompt(title, era) }] },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.2,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty slug response");
  const parsed = JSON.parse(text) as { slug?: string };
  const slug = (parsed.slug ?? "").trim().toLowerCase();
  if (!isValidSlug(slug)) {
    throw new Error(`Gemini が不正な slug を返しました: ${JSON.stringify(parsed)}`);
  }
  return slug;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 40 && SLUG_PATTERN.test(slug);
}

/** 衝突した場合は -2, -3 ... を suffix する */
export function uniquifySlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const cand = `${base}-${i}`;
    if (!taken.has(cand)) return cand;
  }
  throw new Error(`slug 衝突解消に失敗: ${base}`);
}
