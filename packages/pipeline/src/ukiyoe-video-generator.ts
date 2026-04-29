import { fal } from "@fal-ai/client";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Seedance V1 Lite (Bytedance) — Pro より低コスト、ukiyoe タッチ保持○
// 切替前は v1.5/pro（$1.2/M tokens）。Lite は $0.18/M tokens で約 1/7 の課金。
export const SEEDANCE_MODEL = "fal-ai/bytedance/seedance/v1/lite/image-to-video";

const STYLE_SUFFIX =
  "Maintain the original Japanese ukiyo-e woodblock print style throughout. " +
  "Avoid photorealism.";

// Lite は camera_fixed パラメータを受け付けないので、prompt 側で意図を伝える。
const CAMERA_FIXED_HINT = "Camera locked, no panning or zoom.";
const CAMERA_DYNAMIC_HINT = "Camera follows the motion subtly.";

export type UkiyoeActionTag =
  | "running_forward"
  | "eating_meal"
  | "drawing_sword"
  | "walking_carrying"
  | "sleeping"
  | "crowd_cheering"
  | "weather_dynamic"
  | "still_subtle";

interface ActionTagDef {
  prompt: string;
  cameraFixed: boolean;
}

// 各タグの prompt はカメラ運動を含めない（カメラ方針は CAMERA_*_HINT に一本化）。
// 動作・身体・衣服・周囲の動きだけを記述する。
const ACTION_TAG_PROMPTS: Record<UkiyoeActionTag, ActionTagDef> = {
  running_forward: {
    prompt:
      "The figure runs forward dynamically, legs alternating in rapid stride, hair and clothes streaming behind, dust kicked up at the heels.",
    cameraFixed: false,
  },
  eating_meal: {
    prompt:
      "The figure brings food to the mouth slowly, chews, occasional small movements of hands and head.",
    cameraFixed: true,
  },
  drawing_sword: {
    prompt:
      "The warrior pulls a sword from its sheath in one swift motion, cape and clothing flare outward, sleeves snap with the motion.",
    cameraFixed: false,
  },
  walking_carrying: {
    prompt:
      "The figure walks forward steadily carrying a load on the shoulder, the load sways slightly with each step, sleeves and hem move with the gait.",
    cameraFixed: false,
  },
  sleeping: {
    prompt:
      "Subtle rise-and-fall breathing motion, occasional small movement of cloth and blanket, the air shimmers faintly.",
    cameraFixed: true,
  },
  crowd_cheering: {
    prompt:
      "A crowd of people cheers in waves, hands raised and waving, banners and flags flutter in the wind, dust rises from many feet.",
    cameraFixed: true,
  },
  weather_dynamic: {
    prompt:
      "Rain falls diagonally in heavy sheets, lightning flashes across the sky, banners and foliage whip in the strong wind, cloth and hair are buffeted.",
    cameraFixed: true,
  },
  still_subtle: {
    prompt:
      "Gentle wind drifts through the scene, fabric and foliage sway softly, smoke or steam rises slowly.",
    cameraFixed: true,
  },
};

export interface UkiyoeSceneVideoInput {
  index: number;
  imagePath: string;
  /** シーン固有の動作描写（英語推奨）。空文字でもよい */
  scenePrompt: string;
  actionTag?: UkiyoeActionTag;
  /** 明示指定。未指定時は actionTag のデフォルトを使う */
  cameraFixed?: boolean;
  /** Seedance の duration（秒）。既定 5。 */
  duration?: 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
}

export interface UkiyoeVideoResult {
  index: number;
  /** 生成 mp4 のローカル絶対パス（dry-run / error 時は undefined） */
  videoPath?: string;
  /** Seedance に送る最終 prompt（dry-run / 実行 ともに入る） */
  prompt: string;
  duration: number;
  resolution: "480p" | "720p";
  /** USD 試算（dry-run でも事前見積もり、skip では 0） */
  estimatedCostUsd: number;
  elapsedSec: number;
  retried: boolean;
  status: "skipped" | "dry-run" | "done" | "error";
  error?: string;
}

export interface GenerateUkiyoeVideosOptions {
  /** 並列実行数。fal.ai 側のレート制限を踏まえ既定 3 */
  concurrency?: number;
  /** 既に scene-NN.mp4 があれば再生成しない（増分実行）。既定 true */
  skipExisting?: boolean;
  resolution?: "480p" | "720p";
  aspectRatio?: "9:16" | "16:9";
  /** dry-run なら fal.ai を呼ばずに prompt / params を返すだけ。既定 false */
  dryRun?: boolean;
  /** 進捗ログ。指定なければ stdout */
  onProgress?: (msg: string) => void;
}

export function buildUkiyoeVideoPrompt(input: UkiyoeSceneVideoInput): string {
  const tag = input.actionTag ?? "still_subtle";
  const tagPrompt = ACTION_TAG_PROMPTS[tag].prompt;
  const cameraHint = resolveCameraFixed(input)
    ? CAMERA_FIXED_HINT
    : CAMERA_DYNAMIC_HINT;
  return [input.scenePrompt, tagPrompt, cameraHint, STYLE_SUFFIX]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(" ");
}

export function resolveCameraFixed(input: UkiyoeSceneVideoInput): boolean {
  if (input.cameraFixed !== undefined) return input.cameraFixed;
  const tag = input.actionTag ?? "still_subtle";
  return ACTION_TAG_PROMPTS[tag].cameraFixed;
}

function ensureFalConfigured(): void {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      "FAL_KEY is not set in .env.local — add it before generating ukiyoe videos.",
    );
  }
  fal.config({ credentials: key });
}

interface SeedanceCallArgs {
  imagePath: string;
  prompt: string;
  resolution: "480p" | "720p";
  aspectRatio: "9:16" | "16:9";
  duration: number;
  log: (msg: string) => void;
}

interface RawSeedanceResult {
  data?: { video?: { url?: string } };
}

async function callSeedance(args: SeedanceCallArgs): Promise<{ videoUrl: string }> {
  const buffer = await fs.readFile(args.imagePath);
  const ext = path.extname(args.imagePath).slice(1).toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  const file = new File([buffer], path.basename(args.imagePath), { type: mime });
  const imageUrl = await fal.storage.upload(file);

  // Lite の duration union は "5" | ... | "12"。pickDuration で整数保証済み。
  const durationStr = String(args.duration) as
    | "5"
    | "6"
    | "7"
    | "8"
    | "9"
    | "10"
    | "11"
    | "12";

  const result = (await fal.subscribe(SEEDANCE_MODEL, {
    input: {
      image_url: imageUrl,
      prompt: args.prompt,
      aspect_ratio: args.aspectRatio,
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
  if (!videoUrl) {
    throw new Error(`Seedance response missing video.url`);
  }
  return { videoUrl };
}

async function downloadVideo(url: string, outPath: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`video download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
  return buf.byteLength;
}

/**
 * Seedance V1 Lite のコスト試算（USD）。
 * tokens = (h * w * fps * duration) / 1024
 * rate   = $0.18/M (Lite, audio なし)
 */
function estimateUsdCost(args: {
  resolution: "480p" | "720p";
  duration: number;
}): number {
  const dims = args.resolution === "480p" ? { h: 480, w: 854 } : { h: 720, w: 1280 };
  const fps = 24;
  const tokens = (dims.h * dims.w * fps * args.duration) / 1024;
  const ratePerMillion = 0.18;
  return (tokens / 1_000_000) * ratePerMillion;
}

/**
 * 1 シーンだけ生成。CLI のサニティチェックや単発リトライに使う。
 */
export async function generateOneUkiyoeVideo(
  input: UkiyoeSceneVideoInput,
  outputPath: string,
  options: GenerateUkiyoeVideosOptions = {},
): Promise<UkiyoeVideoResult> {
  const log = options.onProgress ?? ((m: string) => console.log(`[ukiyoe-video] ${m}`));
  const skipExisting = options.skipExisting ?? true;
  const resolution = options.resolution ?? "720p";
  const aspectRatio = options.aspectRatio ?? "9:16";
  const dryRun = options.dryRun ?? false;
  const duration = input.duration ?? 5;
  const prompt = buildUkiyoeVideoPrompt(input);
  const estimatedCostUsd = estimateUsdCost({ resolution, duration });

  if (skipExisting && existsSync(outputPath)) {
    log(`scene[${input.index}] skip (exists): ${outputPath}`);
    return {
      index: input.index,
      videoPath: outputPath,
      prompt,
      duration,
      resolution,
      estimatedCostUsd: 0,
      elapsedSec: 0,
      retried: false,
      status: "skipped",
    };
  }

  if (dryRun) {
    log(
      `scene[${input.index}] DRY RUN (would call Seedance Lite, ~$${estimatedCostUsd.toFixed(3)})`,
    );
    return {
      index: input.index,
      prompt,
      duration,
      resolution,
      estimatedCostUsd,
      elapsedSec: 0,
      retried: false,
      status: "dry-run",
    };
  }

  ensureFalConfigured();
  const startedAt = Date.now();

  let retried = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      log(
        `scene[${input.index}] submit (attempt=${attempt + 1}, action=${input.actionTag ?? "still_subtle"})`,
      );
      const { videoUrl } = await callSeedance({
        imagePath: input.imagePath,
        prompt,
        resolution,
        aspectRatio,
        duration,
        log: (m) => log(`scene[${input.index}] ${m}`),
      });
      const bytes = await downloadVideo(videoUrl, outputPath);
      const elapsedSec = (Date.now() - startedAt) / 1000;
      log(
        `scene[${input.index}] done in ${elapsedSec.toFixed(1)}s (${(bytes / 1024).toFixed(0)}KB, $${estimatedCostUsd.toFixed(3)})`,
      );
      return {
        index: input.index,
        videoPath: outputPath,
        prompt,
        duration,
        resolution,
        estimatedCostUsd,
        elapsedSec,
        retried,
        status: "done",
      };
    } catch (err) {
      lastErr = err;
      log(
        `scene[${input.index}] error (attempt=${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`,
      );
      retried = true;
    }
  }
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return {
    index: input.index,
    prompt,
    duration,
    resolution,
    estimatedCostUsd: 0,
    elapsedSec,
    retried,
    status: "error",
    error: errMsg,
  };
}

/**
 * 複数シーンを並列で生成。
 */
export async function generateUkiyoeVideos(
  scenes: UkiyoeSceneVideoInput[],
  videosDir: string,
  options: GenerateUkiyoeVideosOptions = {},
): Promise<UkiyoeVideoResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const log = options.onProgress ?? ((m: string) => console.log(`[ukiyoe-video] ${m}`));

  await fs.mkdir(videosDir, { recursive: true });

  log(
    `start: ${scenes.length} scenes, concurrency=${concurrency}, dir=${videosDir}${options.dryRun ? " [DRY RUN]" : ""}`,
  );

  const results: UkiyoeVideoResult[] = new Array(scenes.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < scenes.length) {
      const i = cursor++;
      const scene = scenes[i]!;
      const outPath = path.join(
        videosDir,
        `scene-${scene.index.toString().padStart(2, "0")}.mp4`,
      );
      results[i] = await generateOneUkiyoeVideo(scene, outPath, {
        ...options,
        onProgress: log,
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, scenes.length) }, () => worker()),
  );

  const totalCost = results.reduce((s, r) => s + r.estimatedCostUsd, 0);
  const generated = results.filter((r) => r.status === "done").length;
  const dryRunCount = results.filter((r) => r.status === "dry-run").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error");
  log(
    `complete: ${generated} generated, ${dryRunCount} dry-run, ${skipped} skipped, ${errors.length} error, total $${totalCost.toFixed(3)}`,
  );

  // 本実行で 1 シーンでも失敗していたら CLI 側で render に進ませない。
  // dry-run / skipped は許容。
  if (!options.dryRun && errors.length > 0) {
    const summary = errors
      .map((r) => `scene[${r.index}]: ${r.error ?? "unknown"}`)
      .join("; ");
    throw new Error(`ukiyoe video generation failed: ${summary}`);
  }

  return results;
}
