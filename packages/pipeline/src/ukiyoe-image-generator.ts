import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promptPath } from "@rekishi/shared/channel";
import { generateImage } from "./image-generator.js";

let cachedStylePrefix: string | null = null;

/**
 * `packages/channels/ukiyoe/prompts/image-prompt.md` を読み、
 * 浮世絵スタイルの固定プレフィクスとして返す。プロセス中で 1 回だけ読む。
 */
export async function loadUkiyoeStylePrefix(): Promise<string> {
  if (cachedStylePrefix) return cachedStylePrefix;
  const md = await fs.readFile(promptPath("image-prompt", "ukiyoe"), "utf-8");
  cachedStylePrefix = md.trim();
  if (!cachedStylePrefix) {
    throw new Error("ukiyoe image-prompt.md is empty");
  }
  return cachedStylePrefix;
}

export interface UkiyoeImageInput {
  index: number;
  /** シーン固有プロンプト（被写体・構図・動勢を英語で） */
  scenePrompt: string;
}

export interface UkiyoeImageResult {
  index: number;
  imagePath: string;
  retried: boolean;
  skipped: boolean;
}

export interface GenerateUkiyoeImagesOptions {
  concurrency?: number;
  skipExisting?: boolean;
  onProgress?: (msg: string) => void;
}

async function generateOne(
  input: UkiyoeImageInput,
  outputPath: string,
  log: (m: string) => void,
  skipExisting: boolean,
): Promise<UkiyoeImageResult> {
  if (skipExisting && existsSync(outputPath)) {
    log(`scene[${input.index}] skip (exists): ${outputPath}`);
    return {
      index: input.index,
      imagePath: outputPath,
      retried: false,
      skipped: true,
    };
  }

  const prefix = await loadUkiyoeStylePrefix();
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
      log(
        `scene[${input.index}] error (attempt=${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`,
      );
      retried = true;
    }
  }
  throw new Error(
    `scene[${input.index}] image generation failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/**
 * 浮世絵スタイル統一の image-gen を複数シーン分まとめて実行する。
 * 並列度（既定 3）と skip-existing でコストを抑える。
 */
export async function generateUkiyoeImages(
  inputs: UkiyoeImageInput[],
  imagesDir: string,
  options: GenerateUkiyoeImagesOptions = {},
): Promise<UkiyoeImageResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const skipExisting = options.skipExisting ?? true;
  const log = options.onProgress ?? ((m: string) => console.log(`[ukiyoe-image] ${m}`));

  await fs.mkdir(imagesDir, { recursive: true });

  log(`start: ${inputs.length} images, concurrency=${concurrency}, dir=${imagesDir}`);

  const results: UkiyoeImageResult[] = new Array(inputs.length);
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
