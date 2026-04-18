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

export interface ResolveResult {
  assets: ImageAsset[];
  usage: { generatedImages: number };
}

export async function resolveSceneAssets(
  scenes: Scene[],
  opts: ResolveOptions,
): Promise<ResolveResult> {
  const { jobId } = opts;
  const allowGeneration = opts.allowGeneration ?? true;
  const results: ImageAsset[] = [];
  let generatedCount = 0;

  for (const scene of scenes) {
    const localPath = dataPath("images", jobId, `scene-${String(scene.index).padStart(2, "0")}.jpg`);

    // 1. Wikimedia を英語→日本語の順で検索 + DL失敗時は次の候補へ
    let asset: ImageAsset | null = null;
    for (const q of [scene.imageQueryEn, scene.imageQueryJa]) {
      const candidates = await searchWikimediaImages(q, { limit: 8 });
      const sortedCandidates = sortBest(candidates);
      for (const best of sortedCandidates.slice(0, 3)) {
        try {
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
        } catch {
          // try next candidate
        }
      }
      if (asset) break;
    }

    // 2. Fallback: Nano Banana 生成（上限あり）
    if (!asset && allowGeneration && generatedCount < MAX_GENERATED_PER_VIDEO) {
      const genPath = path.join(path.dirname(localPath), `scene-${String(scene.index).padStart(2, "0")}.png`);
      try {
        await generateImage(scene.imagePromptEn, genPath);
        generatedCount++;
        asset = {
          sceneIndex: scene.index,
          source: "generated",
          path: genPath,
          license: "Gemini (Nano Banana)",
        };
      } catch {
        // fall through to fallback
      }
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

  return { assets: results, usage: { generatedImages: generatedCount } };
}

/** 縦長寄り・解像度十分・アスペクト極端でないものを優先した順位で返す */
function sortBest<T extends { width: number; height: number }>(images: T[]): T[] {
  return images
    .filter((im) => im.width >= 400 && im.height >= 400)
    .map((im) => {
      const aspect = im.width / im.height;
      const aspectScore = aspect >= 0.4 && aspect <= 1.5 ? 1 : 0.3;
      const sizeScore = Math.min((im.width * im.height) / (1600 * 1600), 1);
      return { im, score: aspectScore * 0.7 + sizeScore * 0.3 };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.im);
}
