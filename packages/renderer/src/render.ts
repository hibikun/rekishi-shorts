import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
// budoux は CJS/ESM interop で tsx subprocess 実行時に named import が
// 解決できないことがあるため namespace import を使う。どちらの形式でもアクセスできる。
import * as budouxNs from "budoux";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UKIYOE_VIDEO_FPS,
  VIDEO_FPS,
  type CaptionSegment,
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

  // 動画冒頭 0.0 秒 SFX。data/sfx/hyoshigi.mp3 が存在すれば自動で乗せる。
  const openingSfxLocalPath = path.resolve(__dirname, "../../../data/sfx/hyoshigi.mp3");
  const openingSfxSrc = fs.existsSync(openingSfxLocalPath)
    ? stageAsset(openingSfxLocalPath, bundleDir, `ukiyoe-opening-sfx${path.extname(openingSfxLocalPath)}`)
    : "";

  // 偶数 index シーン末尾の男衆「オウ！」SFX。data/sfx/otokoshu.mp3 が存在すれば自動で乗せる。
  const cheerSfxLocalPath = path.resolve(__dirname, "../../../data/sfx/otokoshu.mp3");
  const cheerSfxSrc = fs.existsSync(cheerSfxLocalPath)
    ? stageAsset(cheerSfxLocalPath, bundleDir, `ukiyoe-cheer-sfx${path.extname(cheerSfxLocalPath)}`)
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
    openingSfxSrc,
    cheerSfxSrc,
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

// ============================================================================
// Manabilab plan-driven renderer
// ============================================================================

interface ManabilabPlanScene {
  index: number;
  kind: "image" | "title-card";
  startSec: number;
  endSec: number;
  narration: string;
  imagePath: string;
  overlay?: {
    text: string;
    position?: "top" | "center" | "bottom";
    color?: "red" | "white" | "yellow" | "pink";
    fontSize?: number;
  };
}

interface ManabilabPlanLite {
  id: string;
  title: string;
  totalDurationSec: number;
  audio: { path: string };
  scenes: ManabilabPlanScene[];
}

// CJS/ESM 両対応のため default または直接の named export どちらでも引ける形に
const budouxLoader =
  (budouxNs as { loadDefaultJapaneseParser?: () => { parseBoundaries(s: string): number[] } }).loadDefaultJapaneseParser ??
  (budouxNs as { default?: { loadDefaultJapaneseParser?: () => { parseBoundaries(s: string): number[] } } }).default?.loadDefaultJapaneseParser;
if (!budouxLoader) {
  throw new Error("budoux: loadDefaultJapaneseParser export not found");
}
const budouxParser = budouxLoader();

/**
 * narration を Bro Pump 風の短い字幕チャンクに分割する。
 * - 句読点で粗く区切る → 長い文は budoux で形態素境界を見つけて分割
 * - 各チャンクは ~5-13 文字を目標に
 */
function chunkNarrationForCaption(
  narration: string,
  target = 7,
  max = 13,
): string[] {
  const sentences = narration
    .split(/(?<=[、。])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const result: string[] = [];
  for (const sent of sentences) {
    if (sent.length <= max) {
      result.push(sent);
      continue;
    }
    const boundaries = budouxParser.parseBoundaries(sent);
    let start = 0;
    for (const b of boundaries) {
      if (b - start >= target) {
        result.push(sent.slice(start, b));
        start = b;
      }
    }
    if (start < sent.length) {
      const tail = sent.slice(start);
      if (tail.length < 4 && result.length > 0) {
        result[result.length - 1] += tail;
      } else {
        result.push(tail);
      }
    }
  }
  return result;
}

function buildManabilabCaptionSegments(
  scenes: ManabilabPlanScene[],
): CaptionSegment[] {
  const result: CaptionSegment[] = [];
  for (const scene of scenes) {
    const chunks = chunkNarrationForCaption(scene.narration);
    if (chunks.length === 0) continue;
    const dur = Math.max(0, scene.endSec - scene.startSec);
    const totalChars = chunks.reduce((s, c) => s + c.length, 0);
    let cursor = scene.startSec;
    for (const c of chunks) {
      const ratio = totalChars > 0 ? c.length / totalChars : 1 / chunks.length;
      const segDur = dur * ratio;
      result.push({ text: c, startSec: cursor, endSec: cursor + segDur });
      cursor += segDur;
    }
  }
  return result;
}

/**
 * Manabilab plan JSON を読んで Remotion で最終 mp4 をレンダリングする。
 *
 * 入力前提:
 * - plan.scenes[*].imagePath に画像が存在
 * - plan.audio.path に narration wav が存在 (TTS 生成済み)
 * - assets/videos/{planId}/scene-NN.mp4 が揃っている (Seedance 生成済み)
 */
export async function renderManabilabShort(opts: {
  plan: ManabilabPlanLite;
  /** Repo root の絶対パス */
  repoRoot: string;
  /** 出力 mp4 の絶対パス */
  outputPath: string;
  /** plan ID — Seedance mp4 のディレクトリ特定に使う */
  planId: string;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const { plan, repoRoot, outputPath, planId, onProgress } = opts;

  const bundleDir = await bundle({
    entryPoint: getEntryPoint(),
    webpackOverride: (c) => c,
  });

  const stagedScenes = plan.scenes.map((scene, i) => {
    const sceneNum = String(scene.index).padStart(2, "0");
    const idxPad = String(i + 1).padStart(2, "0");

    const imageAbs = path.join(repoRoot, scene.imagePath);
    const imageExt = path.extname(scene.imagePath) || ".png";
    const imageName = `manabilab-scene-${idxPad}-img${imageExt}`;
    const stagedImage = stageAsset(imageAbs, bundleDir, imageName);

    const videoRel = `packages/channels/manabilab/assets/videos/${planId}/scene-${sceneNum}.mp4`;
    const videoAbs = path.join(repoRoot, videoRel);
    const videoName = `manabilab-scene-${idxPad}-vid.mp4`;
    const stagedVideo = fs.existsSync(videoAbs)
      ? stageAsset(videoAbs, bundleDir, videoName)
      : "";

    // duration はシーン間の startSec の差分で計算する。
    // endSec - startSec を使うと、Whisper が拾った句点後の silence ギャップが
    // どこにも含まれなくなり、スライドが音声より先行してズレが累積する。
    // 次シーンの startSec までを今のシーンの duration とすることで、
    // スライドの合計尺 = totalDurationSec に正確に一致する。
    const next = plan.scenes[i + 1];
    const nextStartSec = next ? next.startSec : plan.totalDurationSec;
    const durationSec = Math.max(0.1, nextStartSec - scene.startSec);

    // 注: scene.overlay は plan JSON に残してあるが、レンダラには渡さない。
    // 大きな赤字の「2つだけ」「メカニズム」等は manabilab ブランドでは不要、
    // 字幕で十分に伝わるため全動画共通で非表示。
    return {
      kind: "image" as const,
      src: stagedImage,
      videoSrc: stagedVideo || undefined,
      durationSec,
    };
  });

  const audioAbs = path.isAbsolute(plan.audio.path)
    ? plan.audio.path
    : path.join(repoRoot, plan.audio.path);
  const audioExt = path.extname(plan.audio.path) || ".wav";
  const audioSrc = fs.existsSync(audioAbs)
    ? stageAsset(audioAbs, bundleDir, `manabilab-narration${audioExt}`)
    : "";

  const bgmRel = "packages/renderer/public/manabilab/bgm/uplifting-trance.mp3";
  const bgmAbs = path.join(repoRoot, bgmRel);
  const bgmSrc = fs.existsSync(bgmAbs)
    ? stageAsset(bgmAbs, bundleDir, "manabilab-bgm.mp3")
    : "";

  const captionSegments = buildManabilabCaptionSegments(plan.scenes);

  const inputProps = {
    scenes: stagedScenes,
    totalDurationSec: plan.totalDurationSec,
    audioSrc,
    bgmSrc,
    bgmVolume: 0.05,
    captionSegments,
  };

  const durationInFrames = Math.max(
    1,
    Math.ceil(plan.totalDurationSec * VIDEO_FPS),
  );

  const composition = await selectComposition({
    serveUrl: bundleDir,
    id: "ManabilabShort",
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
      onProgress?.(progress);
      if (progress % 0.1 < 0.01) {
        process.stdout.write(`\r   manabilab render ${(progress * 100).toFixed(0)}%`);
      }
    },
  });
  process.stdout.write("\n");
}
