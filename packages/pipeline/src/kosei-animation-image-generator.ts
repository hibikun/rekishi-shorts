import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promptPath } from "@rekishi/shared/channel";
import { generateImage } from "./image-generator.js";

let cachedStylePrefix: string | null = null;

export async function loadKoseiAnimationStylePrefix(): Promise<string> {
  if (cachedStylePrefix) return cachedStylePrefix;
  const md = await fs.readFile(promptPath("image-prompt", "kosei-animation"), "utf-8");
  cachedStylePrefix = md.trim();
  if (!cachedStylePrefix) {
    throw new Error("kosei-animation image-prompt.md is empty");
  }
  return cachedStylePrefix;
}

export interface KoseiAnimationImageInput {
  index: number;
  scenePrompt: string;
}

export interface KoseiAnimationImageResult {
  index: number;
  imagePath: string;
  retried: boolean;
  skipped: boolean;
}

export interface GenerateKoseiAnimationImagesOptions {
  concurrency?: number;
  skipExisting?: boolean;
  onProgress?: (msg: string) => void;
}

async function generateOne(
  input: KoseiAnimationImageInput,
  outputPath: string,
  log: (m: string) => void,
  skipExisting: boolean,
): Promise<KoseiAnimationImageResult> {
  if (skipExisting && existsSync(outputPath)) {
    log(`scene[${input.index}] skip (exists): ${outputPath}`);
    return {
      index: input.index,
      imagePath: outputPath,
      retried: false,
      skipped: true,
    };
  }

  const prefix = await loadKoseiAnimationStylePrefix();
  const fullPrompt = `${prefix}\n\nScene: ${input.scenePrompt}`;

  let retried = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      log(`scene[${input.index}] generating (attempt=${attempt + 1})`);
      await generateImage(fullPrompt, outputPath);
      log(`scene[${input.index}] saved: ${outputPath}`);
      return {
        index: input.index,
        imagePath: outputPath,
        retried,
        skipped: false,
      };
    } catch (err) {
      lastErr = err;
      retried = true;
      log(
        `scene[${input.index}] error (attempt=${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    `scene[${input.index}] image generation failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

export async function generateKoseiAnimationImages(
  inputs: KoseiAnimationImageInput[],
  imagesDir: string,
  options: GenerateKoseiAnimationImagesOptions = {},
): Promise<KoseiAnimationImageResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const skipExisting = options.skipExisting ?? true;
  const log =
    options.onProgress ?? ((m: string) => console.log(`[kosei-animation-image] ${m}`));

  await fs.mkdir(imagesDir, { recursive: true });
  log(`start: ${inputs.length} images, concurrency=${concurrency}, dir=${imagesDir}`);

  const results: KoseiAnimationImageResult[] = new Array(inputs.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < inputs.length) {
      const i = cursor++;
      const input = inputs[i]!;
      const outPath = path.join(
        imagesDir,
        `scene-${input.index.toString().padStart(2, "0")}.png`,
      );
      results[i] = await generateOne(input, outPath, log, skipExisting);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()),
  );

  const generated = results.filter((r) => !r.skipped).length;
  log(
    `complete: ${generated}/${results.length} generated, ${results.length - generated} skipped`,
  );

  return results;
}
