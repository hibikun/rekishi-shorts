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

function resolveBgmPath(): string | null {
  const override = process.env.BGM_PATH?.trim();
  const repoRoot = path.resolve(__dirname, "../../../");
  const candidates: string[] = [];
  if (override) {
    candidates.push(path.isAbsolute(override) ? override : path.resolve(repoRoot, override));
  }
  const defaultDir = path.join(repoRoot, "data", "bgm");
  for (const ext of ["mp3", "wav", "m4a", "ogg"]) {
    candidates.push(path.join(defaultDir, `default.${ext}`));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveBgm(bundleDir: string): { src: string; volume: number } {
  const bgmPath = resolveBgmPath();
  if (!bgmPath) return { src: "", volume: 0 };
  const src = stageAsset(bgmPath, bundleDir, `bgm${path.extname(bgmPath)}`);
  const rawVolume = Number.parseFloat(process.env.BGM_VOLUME ?? "");
  const volume = Number.isFinite(rawVolume) && rawVolume >= 0 ? Math.min(1, rawVolume) : 0.12;
  return { src, volume };
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
  const { src: bgmSrc, volume: bgmVolume } = resolveBgm(bundleDir);

  const durationInFrames = Math.max(1, Math.ceil(plan.totalDurationSec * VIDEO_FPS));

  const inputProps = {
    scenes: plan.scenes,
    images: stagedImages,
    audioSrc,
    captions: plan.captions,
    captionSegments: plan.captionSegments,
    totalDurationSec: plan.totalDurationSec,
    keyTerms: plan.script.keyTerms,
    teaserCaption: plan.script.teaserCaption,
    bgmSrc,
    bgmVolume,
  };

  const composition = await selectComposition({
    serveUrl: bundleDir,
    id: "HistoryShort",
    inputProps,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await renderMedia({
    composition: { ...composition, durationInFrames },
    serveUrl: bundleDir,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      if (progress % 0.1 < 0.01) {
        process.stdout.write(`\r   render ${(progress * 100).toFixed(0)}%`);
      }
    },
  });
  process.stdout.write("\n");
}
