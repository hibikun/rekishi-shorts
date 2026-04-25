import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO_FPS, type RankingPlan, type RenderPlan } from "@rekishi/shared";

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

  // フック直後 SFX。data/sfx/wadaiko.mp3 が存在すれば自動で乗せる。
  const sfxLocalPath = path.resolve(__dirname, "../../../data/sfx/wadaiko.mp3");
  const hookSfxSrc = fs.existsSync(sfxLocalPath)
    ? stageAsset(sfxLocalPath, bundleDir, `hook-sfx${path.extname(sfxLocalPath)}`)
    : "";

  // 動画冒頭 0.0 秒 SFX。data/sfx/hyoshigi.mp3 が存在すれば自動で乗せる。
  const openingSfxLocalPath = path.resolve(__dirname, "../../../data/sfx/hyoshigi.mp3");
  const openingSfxSrc = fs.existsSync(openingSfxLocalPath)
    ? stageAsset(openingSfxLocalPath, bundleDir, `opening-sfx${path.extname(openingSfxLocalPath)}`)
    : "";

  const durationInFrames = Math.max(1, Math.ceil(plan.totalDurationSec * VIDEO_FPS));

  const inputProps = {
    scenes: plan.scenes,
    images: stagedImages,
    audioSrc,
    captions: plan.captions,
    captionSegments: plan.captionSegments,
    totalDurationSec: plan.totalDurationSec,
    keyTerms: plan.script.keyTerms,
    title: plan.script.title,
    hookSfxSrc,
    openingSfxSrc,
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

export async function renderRankingShort(
  plan: RankingPlan,
  outputPath: string,
): Promise<void> {
  const bundleDir = await bundle({
    entryPoint: getEntryPoint(),
    webpackOverride: (c) => c,
  });

  // 画像 (背景 + 商品3枚) と音声を bundle dir に配置
  const backgroundImagePath = stageAsset(
    plan.backgroundImagePath,
    bundleDir,
    `ranking-background${path.extname(plan.backgroundImagePath) || ".jpg"}`,
  );

  const stagedItems = plan.items.map((item) => ({
    ...item,
    productImagePath: stageAsset(
      item.productImagePath,
      bundleDir,
      `ranking-product-${item.rank}${path.extname(item.productImagePath) || ".jpg"}`,
    ),
  }));

  const audioSrc = plan.audioPath
    ? stageAsset(
        plan.audioPath,
        bundleDir,
        `ranking-narration${path.extname(plan.audioPath) || ".mp3"}`,
      )
    : "";

  const bgmSrc = plan.bgmPath
    ? stageAsset(
        plan.bgmPath,
        bundleDir,
        `ranking-bgm${path.extname(plan.bgmPath) || ".mp3"}`,
      )
    : "";

  const rankSfxSrc = plan.rankSfxPath
    ? stageAsset(
        plan.rankSfxPath,
        bundleDir,
        `ranking-rank-sfx${path.extname(plan.rankSfxPath) || ".mp3"}`,
      )
    : "";

  const hookSfxSrc = plan.hookSfxPath
    ? stageAsset(
        plan.hookSfxPath,
        bundleDir,
        `ranking-hook-sfx${path.extname(plan.hookSfxPath) || ".mp3"}`,
      )
    : "";

  // icon の src も stage
  const stagedIcons = plan.opening.icons?.map((icon, idx) => {
    if (!icon.src) return icon;
    const ext = path.extname(icon.src) || ".png";
    return {
      ...icon,
      src: stageAsset(icon.src, bundleDir, `ranking-icon-${idx}${ext}`),
    };
  });

  const durationInFrames = Math.max(
    1,
    Math.ceil(plan.totalDurationSec * VIDEO_FPS),
  );

  const inputProps = {
    opening: { ...plan.opening, icons: stagedIcons },
    items: stagedItems,
    backgroundImagePath,
    closing: plan.closing,
    totalDurationSec: plan.totalDurationSec,
    audioSrc,
    bgmSrc,
    rankSfxSrc,
    hookSfxSrc,
    scenes: plan.scenes,
  };

  const composition = await selectComposition({
    serveUrl: bundleDir,
    id: "RankingShort",
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
