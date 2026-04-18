import path from "node:path";
import type { Scene, ImageAsset } from "@rekishi/shared";
import { dataPath } from "./config.js";
import { searchWikimediaImages, downloadImage } from "./wikimedia-fetcher.js";
import { generateImage } from "./image-generator.js";

const MAX_GENERATED_PER_VIDEO = 5;

export interface ResolveOptions {
  jobId: string;
  /** Nano Banana フォールバック生成を許可するか */
  allowGeneration?: boolean;
}

export async function resolveSceneAssets(
  scenes: Scene[],
  opts: ResolveOptions,
): Promise<ImageAsset[]> {
  const { jobId } = opts;
  const allowGeneration = opts.allowGeneration ?? true;
  const results: ImageAsset[] = [];
  let generatedCount = 0;

  for (const scene of scenes) {
    const localPath = dataPath("images", jobId, `scene-${String(scene.index).padStart(2, "0")}.jpg`);

    // 1. Wikimedia を英語→日本語の順で検索
    let asset: ImageAsset | null = null;
    for (const q of [scene.imageQueryEn, scene.imageQueryJa]) {
      const candidates = await searchWikimediaImages(q, { limit: 8 });
      const best = pickBest(candidates);
      if (best) {
        await downloadImage(best.imageUrl, localPath);
        asset = {
          sceneIndex: scene.index,
          source: "wikimedia",
          path: localPath,
          license: best.license,
          attribution: best.attribution,
          sourceUrl: best.pageUrl,
        };
        break;
      }
    }

    // 2. Fallback: Nano Banana 生成（上限あり）
    if (!asset && allowGeneration && generatedCount < MAX_GENERATED_PER_VIDEO) {
      const genPath = path.join(path.dirname(localPath), `scene-${String(scene.index).padStart(2, "0")}.png`);
      await generateImage(scene.imagePromptEn, genPath);
      generatedCount++;
      asset = {
        sceneIndex: scene.index,
        source: "generated",
        path: genPath,
        license: "Gemini (Nano Banana)",
      };
    }

    // 3. 諦め（空のプレースホルダ asset、renderer 側で黒背景フォールバック）
    if (!asset) {
      asset = {
        sceneIndex: scene.index,
        source: "fallback",
        path: "",
        license: "none",
      };
    }

    results.push(asset);
  }

  return results;
}

/** 縦長寄り・解像度十分・アスペクト極端でないものを優先 */
function pickBest<T extends { width: number; height: number }>(images: T[]): T | undefined {
  if (images.length === 0) return undefined;
  const scored = images
    .filter((im) => im.width >= 600 && im.height >= 600)
    .map((im) => {
      const aspect = im.width / im.height;
      // 9:16 (0.5625) に近いほど高スコア、横長は減点
      const aspectScore = aspect >= 0.4 && aspect <= 1.5 ? 1 : 0.3;
      const sizeScore = Math.min((im.width * im.height) / (1600 * 1600), 1);
      return { im, score: aspectScore * 0.7 + sizeScore * 0.3 };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.im;
}
