import { synthesizeNarration } from "./tts-generator.js";

export interface GenerateSceneTtsOptions {
  /** 読み上げる本文 */
  text: string;
  /** 出力先 wav の絶対パス */
  destPath: string;
  /** Gemini TTS の prebuilt voice 名。未指定なら manabilab-canva 既定 (Charon) */
  voiceName?: string;
  /** style prompt の上書き。空ならチャンネル既定 */
  stylePromptOverride?: string;
  /** Gemini TTS モデル ID の上書き */
  modelOverride?: string;
  /** 難読語マップ（script.json の readings をそのまま渡す） */
  readings?: Record<string, string>;
}

export interface GenerateSceneTtsResult {
  audioPath: string;
  durationSec: number;
  characters: number;
  model: string;
}

/**
 * manabilab-canva 用に scene 単位の wav を 1 本生成する薄いラッパー。
 * 既存 synthesizeNarration を呼ぶだけ。連結（複数 scene を 1 本にまとめる）はしない。
 */
export async function generateSceneTts(
  options: GenerateSceneTtsOptions,
): Promise<GenerateSceneTtsResult> {
  const result = await synthesizeNarration(options.text, options.destPath, {
    voiceName: options.voiceName,
    stylePromptOverride: options.stylePromptOverride,
    modelOverride: options.modelOverride,
    readings: options.readings,
    persona: "narrator",
  });

  return {
    audioPath: result.path,
    durationSec: result.approxDurationSec,
    characters: result.characters,
    model: result.usage.model,
  };
}
