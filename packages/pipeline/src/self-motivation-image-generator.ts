import { generateImage } from "./image-generator.js";

export interface GenerateLongformImageOptions {
  /** 同一キャラを別シーンで使うための参照画像（絶対パス）。1〜数枚 */
  referenceImages?: string[];
}

/**
 * 16:9 横長を要求する英語サフィックスを付けて Nano Banana を呼ぶ薄いラッパー。
 * image-generator.ts の generateImage は default で 9:16 サフィックスを付けるため、
 * appendAspectSuffix=false にして自前のサフィックスに差し替える。
 *
 * referenceImages を渡すとキャラ一貫性を保った別シーンを生成できる
 * （Nano Banana にそのまま inlineData として流される）。
 */
export async function generateLongformImage(
  prompt: string,
  destPath: string,
  options: GenerateLongformImageOptions = {},
): Promise<void> {
  const fullPrompt = `${prompt}\n\nAspect ratio: 16:9 (horizontal, widescreen). High quality editorial photograph, suitable for a long-form motivational video.`;
  await generateImage(fullPrompt, destPath, {
    appendAspectSuffix: false,
    referenceImages: options.referenceImages,
  });
}
