/**
 * 学びラボ用 Seedance V1 Lite img2video ジェネレータ。
 *
 * 入力:
 *   - plan JSON (packages/channels/manabilab/plans/<planId>.json)
 *
 * 出力:
 *   - 各 image scene につき 1 mp4: data/manabilab/videos/<planId>/scene-NN.mp4
 *   - 戻り値で各シーンの結果 (path, costUsd, status, ...)
 *
 * dry-run モード:
 *   - fal.ai は呼ばずに、各シーンに送る prompt / params をそのまま返す。
 *   - クリック → API → 内容確認、までを実行コストゼロで疎通確認するため。
 */
import { fal } from "@fal-ai/client";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Seedance V1 Lite (Bytedance) — Pro より低コスト、カートゥーン保持○
export const MANABILAB_VIDEO_MODEL = "fal-ai/bytedance/seedance/v1/lite/image-to-video";

export interface ManabilabPlanScene {
  index: number;
  kind: "image" | "title-card";
  beat: string;
  startSec: number;
  endSec: number;
  narration: string;
  imagePath?: string;
  seedancePrompt?: string;
  seedanceClipPath?: string | null;
  approved: boolean;
}

export interface ManabilabPlan {
  id: string;
  title: string;
  totalDurationSec: number;
  scenes: ManabilabPlanScene[];
  // 他フィールドあるが generator には不要
}

export interface ManabilabVideoSceneResult {
  index: number;
  /** 生成 mp4 のローカル絶対パス */
  videoPath?: string;
  /** dry-run / 実行 でも入る、Seedance に渡す prompt と params */
  prompt: string;
  duration: number;
  resolution: "480p" | "720p";
  /** USD コスト試算（dry-run でも事前見積もり） */
  estimatedCostUsd: number;
  /** 実行時の経過秒。dry-run / skip では 0 */
  elapsedSec: number;
  status: "skipped" | "dry-run" | "done" | "error";
  error?: string;
}

export interface GenerateManabilabVideosOptions {
  planId: string;
  /** dry-run なら fal.ai 呼ばず prompt 等を返すだけ。default false */
  dryRun?: boolean;
  /** 既に scene-NN.mp4 があれば再生成しない。default true */
  skipExisting?: boolean;
  /** Seedance 解像度。default 720p */
  resolution?: "480p" | "720p";
  /** 並列数。default 3 */
  concurrency?: number;
  /** 指定したシーンだけ処理する（1始まり）。空/未指定なら全シーン */
  sceneIndices?: number[];
  /** 進捗ログ。指定なければ console.log */
  onProgress?: (msg: string) => void;
}

export interface GenerateManabilabVideosResult {
  planId: string;
  model: string;
  dryRun: boolean;
  resolution: "480p" | "720p";
  scenes: ManabilabVideoSceneResult[];
  totalEstimatedCostUsd: number;
  totalElapsedSec: number;
}

const REPO_ROOT = config.paths.repoRoot;

function videoOutDir(planId: string): string {
  return path.join(REPO_ROOT, "data", "manabilab", "videos", planId);
}

function videoOutPath(planId: string, sceneIndex: number): string {
  return path.join(videoOutDir(planId), `scene-${String(sceneIndex).padStart(2, "0")}.mp4`);
}

function planJsonPath(planId: string): string {
  return path.join(
    REPO_ROOT,
    "packages",
    "channels",
    "manabilab",
    "plans",
    `${planId}.json`,
  );
}

export async function loadManabilabPlan(planId: string): Promise<ManabilabPlan> {
  const raw = await fs.readFile(planJsonPath(planId), "utf-8");
  return JSON.parse(raw) as ManabilabPlan;
}

/**
 * Seedance Lite が受け付ける duration の最小値。短いシーンも 5sec 生成して renderer 側でトリム。
 */
const SEEDANCE_DURATION_MIN = 5;
const SEEDANCE_DURATION_MAX = 12;

function pickSeedanceDuration(sceneSec: number): number {
  const ceiled = Math.ceil(sceneSec);
  if (ceiled < SEEDANCE_DURATION_MIN) return SEEDANCE_DURATION_MIN;
  if (ceiled > SEEDANCE_DURATION_MAX) return SEEDANCE_DURATION_MAX;
  return ceiled;
}

/**
 * Seedance Lite のコスト試算（USD）— トークン課金。
 * fal.ai 公式: lite v1 i2v は token rate $0.18/M (no audio) 想定。
 * tokens = (h * w * fps * duration) / 1024
 */
function estimateUsdCost(args: {
  resolution: "480p" | "720p";
  duration: number;
}): number {
  const dims = args.resolution === "480p" ? { h: 480, w: 854 } : { h: 720, w: 1280 };
  const fps = 24;
  const tokens = (dims.h * dims.w * fps * args.duration) / 1024;
  const ratePerMillion = 0.18; // USD / 1M tokens (Lite)
  return (tokens / 1_000_000) * ratePerMillion;
}

function ensureFalConfigured(): void {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      "FAL_KEY is not set in .env.local — add it before generating videos.",
    );
  }
  fal.config({ credentials: key });
}

interface RawSeedanceResult {
  data?: { video?: { url?: string } };
}

async function callSeedanceLite(args: {
  imageAbsPath: string;
  prompt: string;
  resolution: "480p" | "720p";
  duration: number;
  log: (msg: string) => void;
}): Promise<{ videoUrl: string }> {
  const buffer = await fs.readFile(args.imageAbsPath);
  const ext = path.extname(args.imageAbsPath).slice(1).toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  const file = new File([buffer], path.basename(args.imageAbsPath), { type: mime });
  const imageUrl = await fal.storage.upload(file);

  // Seedance Lite の duration 型は厳しい union ("3" | "4" | ... | "12") なので
  // string キャストで通す。値は pickSeedanceDuration() で 5-12 の整数に保証済み。
  const durationStr = String(args.duration) as "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";
  const result = (await fal.subscribe(MANABILAB_VIDEO_MODEL, {
    input: {
      image_url: imageUrl,
      prompt: args.prompt,
      aspect_ratio: "9:16",
      resolution: args.resolution,
      duration: durationStr,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        update.logs?.forEach((l) => args.log(l.message));
      }
    },
  })) as RawSeedanceResult;

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) throw new Error("Seedance Lite returned no video.url");
  return { videoUrl };
}

async function downloadVideo(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`video download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
}

async function processScene(
  planId: string,
  scene: ManabilabPlanScene,
  opts: Required<Pick<GenerateManabilabVideosOptions, "dryRun" | "skipExisting" | "resolution">>,
  onProgress: (msg: string) => void,
): Promise<ManabilabVideoSceneResult> {
  const sceneSec = scene.endSec - scene.startSec;
  const duration = pickSeedanceDuration(sceneSec);
  const resolution = opts.resolution;
  const estimatedCostUsd = estimateUsdCost({ resolution, duration });

  // title-card は Seedance 不要（Composition で直接描画）
  if (scene.kind === "title-card") {
    return {
      index: scene.index,
      prompt: "(title-card: no Seedance needed)",
      duration: 0,
      resolution,
      estimatedCostUsd: 0,
      elapsedSec: 0,
      status: "skipped",
    };
  }

  if (!scene.imagePath) {
    return {
      index: scene.index,
      prompt: "(no imagePath)",
      duration,
      resolution,
      estimatedCostUsd: 0,
      elapsedSec: 0,
      status: "error",
      error: "image scene has no imagePath",
    };
  }

  const prompt = scene.seedancePrompt?.trim() || "Subtle gentle motion. Maintain the original style.";
  const outPath = videoOutPath(planId, scene.index);

  if (opts.skipExisting && existsSync(outPath)) {
    onProgress(`  scene ${scene.index}: skip (already exists)`);
    return {
      index: scene.index,
      videoPath: outPath,
      prompt,
      duration,
      resolution,
      estimatedCostUsd: 0,
      elapsedSec: 0,
      status: "skipped",
    };
  }

  if (opts.dryRun) {
    onProgress(`  scene ${scene.index}: DRY RUN (would call Seedance Lite, ~$${estimatedCostUsd.toFixed(3)})`);
    return {
      index: scene.index,
      prompt,
      duration,
      resolution,
      estimatedCostUsd,
      elapsedSec: 0,
      status: "dry-run",
    };
  }

  // 実行モード（Phase 2 では呼ばれない想定だが完全実装）
  const start = Date.now();
  try {
    onProgress(`  scene ${scene.index}: calling Seedance Lite (duration=${duration}s, ${resolution})...`);
    const imageAbsPath = path.isAbsolute(scene.imagePath)
      ? scene.imagePath
      : path.join(REPO_ROOT, scene.imagePath);
    const { videoUrl } = await callSeedanceLite({
      imageAbsPath,
      prompt,
      resolution,
      duration,
      log: (msg) => onProgress(`    ${msg}`),
    });
    await downloadVideo(videoUrl, outPath);
    const elapsedSec = (Date.now() - start) / 1000;
    onProgress(`  scene ${scene.index}: ✓ done (${elapsedSec.toFixed(1)}s, ~$${estimatedCostUsd.toFixed(3)})`);
    return {
      index: scene.index,
      videoPath: outPath,
      prompt,
      duration,
      resolution,
      estimatedCostUsd,
      elapsedSec,
      status: "done",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onProgress(`  scene ${scene.index}: ✗ error: ${msg}`);
    return {
      index: scene.index,
      prompt,
      duration,
      resolution,
      estimatedCostUsd: 0,
      elapsedSec: (Date.now() - start) / 1000,
      status: "error",
      error: msg,
    };
  }
}

export async function generateManabilabVideos(
  options: GenerateManabilabVideosOptions,
): Promise<GenerateManabilabVideosResult> {
  const dryRun = options.dryRun ?? false;
  const skipExisting = options.skipExisting ?? true;
  const resolution = options.resolution ?? "720p";
  const concurrency = options.concurrency ?? 3;
  const onProgress = options.onProgress ?? ((m) => console.log(m));

  if (!dryRun) ensureFalConfigured();

  const plan = await loadManabilabPlan(options.planId);
  await fs.mkdir(videoOutDir(options.planId), { recursive: true });

  // sceneIndices フィルタ適用
  const filterSet = options.sceneIndices && options.sceneIndices.length > 0
    ? new Set(options.sceneIndices)
    : null;
  const targetScenes = filterSet
    ? plan.scenes.filter((s) => filterSet.has(s.index))
    : plan.scenes;

  onProgress(
    `[${dryRun ? "DRY RUN" : "EXEC"}] Seedance V1 Lite で ${targetScenes.filter((s) => s.kind === "image").length} シーンを処理開始 (${resolution}, concurrency=${concurrency}${filterSet ? `, indices=[${[...filterSet].join(",")}]` : ""})`,
  );

  // 並列処理 (シンプルなセマフォ)
  const results: ManabilabVideoSceneResult[] = [];
  const queue = [...targetScenes];
  const totalStart = Date.now();
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const scene = queue.shift();
      if (!scene) break;
      const r = await processScene(options.planId, scene, { dryRun, skipExisting, resolution }, onProgress);
      results.push(r);
    }
  });
  await Promise.all(workers);

  results.sort((a, b) => a.index - b.index);
  const totalElapsedSec = (Date.now() - totalStart) / 1000;
  const totalEstimatedCostUsd = results.reduce((sum, r) => sum + r.estimatedCostUsd, 0);

  onProgress(
    `[${dryRun ? "DRY RUN" : "EXEC"}] 完了。total ~$${totalEstimatedCostUsd.toFixed(3)} / ${totalElapsedSec.toFixed(1)}s`,
  );

  return {
    planId: options.planId,
    model: MANABILAB_VIDEO_MODEL,
    dryRun,
    resolution,
    scenes: results,
    totalEstimatedCostUsd,
    totalElapsedSec,
  };
}
