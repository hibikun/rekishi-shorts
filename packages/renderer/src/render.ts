import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UKIYOE_VIDEO_FPS,
  VIDEO_FPS,
  type RankingPlan,
  type RenderPlan,
  type UkiyoePlan,
} from "@rekishi/shared";

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

  // scene[2] 終端の男衆「オウ！」SFX。data/sfx/otokoshu.mp3 が存在すれば自動で乗せる。
  const cheerSfxLocalPath = path.resolve(__dirname, "../../../data/sfx/otokoshu.mp3");
  const cheerSfxSrc = fs.existsSync(cheerSfxLocalPath)
    ? stageAsset(cheerSfxLocalPath, bundleDir, `cheer-sfx${path.extname(cheerSfxLocalPath)}`)
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
    cheerSfxSrc,
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

/**
 * UkiyoePlan を読んで Remotion でレンダリングする。各シーンの mp4 と
 * narration を bundleDir に hardlink してから UkiyoeShort を組み立てる。
 */
export async function renderUkiyoeShort(
  plan: UkiyoePlan,
  outputPath: string,
): Promise<void> {
  const bundleDir = await bundle({
    entryPoint: getEntryPoint(),
    webpackOverride: (c) => c,
  });

  const stagedScenes = plan.scenes.map((scene) => {
    const token = String(scene.index).padStart(2, "0");
    const stagedVideoName = stageAsset(
      scene.videoPath,
      bundleDir,
      `ukiyoe-scene-${token}.mp4`,
    );
    return { ...scene, videoPath: stagedVideoName };
  });

  const audioSrc = plan.audioPath
    ? stageAsset(
        plan.audioPath,
        bundleDir,
        `ukiyoe-narration${path.extname(plan.audioPath) || ".wav"}`,
      )
    : "";

  const durationInFrames = Math.max(
    1,
    Math.ceil(plan.totalDurationSec * UKIYOE_VIDEO_FPS),
  );

  const inputProps = {
    scenes: stagedScenes,
    audioSrc,
    captions: plan.captions,
    captionSegments: plan.captionSegments,
    totalDurationSec: plan.totalDurationSec,
    keyTerms: plan.keyTerms,
  };

  const composition = await selectComposition({
    serveUrl: bundleDir,
    id: "UkiyoeShort",
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

  // 動画冒頭 0.0 秒 SFX。plan.hookSfxPath が無ければ data/sfx/hyoshigi.mp3 を自動装着（rekishi と同パターン）
  const hookSfxLocalPath =
    plan.hookSfxPath ?? path.resolve(__dirname, "../../../data/sfx/hyoshigi.mp3");
  const hookSfxSrc = fs.existsSync(hookSfxLocalPath)
    ? stageAsset(
        hookSfxLocalPath,
        bundleDir,
        `ranking-hook-sfx${path.extname(hookSfxLocalPath) || ".mp3"}`,
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
    hookSfxVolume: 1,
    scenes: plan.scenes,
    audioClips: plan.audioClips,
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
