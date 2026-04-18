import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO_FPS, type RenderPlan } from "@rekishi/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getEntryPoint(): string {
  return path.resolve(__dirname, "./index.ts");
}

/**
 * bundleDir に画像と音声を hardlink し、Remotion dev server 経由で serve できるようにする。
 * 戻り値は bundle 内から見た相対 URL (bare filename)。
 */
function stageAsset(localPath: string, bundleDir: string, name: string): string {
  if (!localPath) return "";
  if (!fs.existsSync(localPath)) return "";
  const target = path.join(bundleDir, name);
  try {
    fs.unlinkSync(target);
  } catch {
    /* noop */
  }
  try {
    fs.linkSync(localPath, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      fs.copyFileSync(localPath, target);
    } else {
      throw err;
    }
  }
  return name;
}

export async function renderHistoryShort(plan: RenderPlan, outputPath: string): Promise<void> {
  const bundleDir = await bundle({
    entryPoint: getEntryPoint(),
    webpackOverride: (c) => c,
  });

  // 画像と音声を bundle dir に配置
  const stagedImages = plan.images.map((img) => {
    const filename = `scene-${String(img.sceneIndex).padStart(2, "0")}${path.extname(img.path) || ".jpg"}`;
    return { ...img, path: stageAsset(img.path, bundleDir, filename) };
  });
  const audioSrc = stageAsset(plan.audio.path, bundleDir, `narration${path.extname(plan.audio.path) || ".mp3"}`);

  const durationInFrames = Math.max(1, Math.ceil(plan.totalDurationSec * VIDEO_FPS));

  const composition = await selectComposition({
    serveUrl: bundleDir,
    id: "HistoryShort",
    inputProps: {
      scenes: plan.scenes,
      images: stagedImages,
      audioSrc,
      captions: plan.captions,
      totalDurationSec: plan.totalDurationSec,
    },
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await renderMedia({
    composition: { ...composition, durationInFrames },
    serveUrl: bundleDir,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: {
      scenes: plan.scenes,
      images: stagedImages,
      audioSrc,
      captions: plan.captions,
      totalDurationSec: plan.totalDurationSec,
    },
    onProgress: ({ progress }) => {
      if (progress % 0.1 < 0.01) {
        process.stdout.write(`\r   render ${(progress * 100).toFixed(0)}%`);
      }
    },
  });
  process.stdout.write("\n");
}
