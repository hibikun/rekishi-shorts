import { generateImage } from "./image-generator.js";

/**
 * 16:9 横長を要求する英語サフィックスを付けて Nano Banana を呼ぶ薄いラッパー。
 * image-generator.ts の generateImage は default で 9:16 サフィックスを付けるため、
 * appendAspectSuffix=false にして自前のサフィックスに差し替える。
 */
export async function generateLongformImage(
  prompt: string,
  destPath: string,
): Promise<void> {
  const fullPrompt = `${prompt}\n\nAspect ratio: 16:9 (horizontal, widescreen). High quality editorial photograph, suitable for a long-form motivational video.`;
  await generateImage(fullPrompt, destPath, { appendAspectSuffix: false });
}
