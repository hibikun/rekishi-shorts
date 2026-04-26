import { fal } from "@fal-ai/client";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SEEDANCE_MODEL = "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";

const STYLE_SUFFIX =
  "Maintain the original Japanese ukiyo-e woodblock print style throughout. " +
  "Avoid photorealism.";

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

const ACTION_TAG_PROMPTS: Record<UkiyoeActionTag, ActionTagDef> = {
  running_forward: {
    prompt:
      "The figure runs forward dynamically, legs alternating, hair and clothes streaming back, scenery passes by.",
    cameraFixed: false,
  },
  eating_meal: {
    prompt:
      "The figure brings food to the mouth slowly, chews, occasional small movements of hands and head.",
    cameraFixed: true,
  },
  drawing_sword: {
    prompt:
      "The warrior pulls a sword from its sheath in one swift motion, cape and clothing flare outward.",
    cameraFixed: false,
  },
  walking_carrying: {
    prompt:
      "The figure walks forward steadily carrying a load on the shoulder, the load sways slightly.",
    cameraFixed: false,
  },
  sleeping: {
    prompt:
      "Subtle breathing motion, occasional small movement of cloth and blanket.",
    cameraFixed: true,
  },
  crowd_cheering: {
    prompt:
      "A crowd of people cheers, hands waving, banners fluttering in the wind.",
    cameraFixed: true,
  },
  weather_dynamic: {
    prompt:
      "Rain falls diagonally, lightning flashes across the sky, banners and foliage move in the strong wind.",
    cameraFixed: true,
  },
  still_subtle: {
    prompt: "Gentle wind moves through the scene, slow slight camera push-in.",
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
  duration?: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
}

export interface UkiyoeVideoResult {
  index: number;
  videoPath: string;
  /** USD 試算（生成時のみ。skip 時は 0） */
  costUsd: number;
  elapsedSec: number;
  retried: boolean;
  skipped: boolean;
}

export interface GenerateUkiyoeVideosOptions {
  /** 並列実行数。fal.ai 側のレート制限を踏まえ既定 3 */
  concurrency?: number;
  /** 既に scene-NN.mp4 があれば再生成しない（増分実行）。既定 true */
  skipExisting?: boolean;
  resolution?: "480p" | "720p";
  aspectRatio?: "9:16" | "16:9";
  /** Seedance の音声生成。チャンネルでは別途 TTS を使うので既定 false */
  generateAudio?: boolean;
  /** 進捗ログ。指定なければ stdout */
  onProgress?: (msg: string) => void;
}

export function buildUkiyoeVideoPrompt(input: UkiyoeSceneVideoInput): string {
  const tag = input.actionTag ?? "still_subtle";
  const tagPrompt = ACTION_TAG_PROMPTS[tag].prompt;
  return [input.scenePrompt, tagPrompt, STYLE_SUFFIX]
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
  generateAudio: boolean;
  cameraFixed: boolean;
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

  const result = (await fal.subscribe(SEEDANCE_MODEL, {
    input: {
      image_url: imageUrl,
      prompt: args.prompt,
      aspect_ratio: args.aspectRatio,
      resolution: args.resolution,
      duration: String(args.duration) as "5",
      generate_audio: args.generateAudio,
      camera_fixed: args.cameraFixed,
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
 * Seedance 1.5 Pro のコスト試算（USD）。
 * tokens = (h * w * fps * duration) / 1024
 * rate   = $1.2/M (no audio) or $2.4/M (with audio)
 */
function estimateUsdCost(args: {
  resolution: "480p" | "720p";
  duration: number;
  generateAudio: boolean;
}): number {
  const dims = args.resolution === "480p" ? { h: 480, w: 854 } : { h: 720, w: 1280 };
  const fps = 24;
  const tokens = (dims.h * dims.w * fps * args.duration) / 1024;
  const rate = args.generateAudio ? 2.4 : 1.2;
  return (tokens / 1_000_000) * rate;
}

/**
 * 1 シーンだけ生成。CLI のサニティチェックや単発リトライに使う。
 */
export async function generateOneUkiyoeVideo(
  input: UkiyoeSceneVideoInput,
  outputPath: string,
  options: GenerateUkiyoeVideosOptions = {},
): Promise<UkiyoeVideoResult> {
  ensureFalConfigured();

  const log = options.onProgress ?? ((m: string) => console.log(`[ukiyoe-video] ${m}`));
  const skipExisting = options.skipExisting ?? true;
  const resolution = options.resolution ?? "720p";
  const aspectRatio = options.aspectRatio ?? "9:16";
  const generateAudio = options.generateAudio ?? false;
  const duration = input.duration ?? 5;

  if (skipExisting && existsSync(outputPath)) {
    log(`scene[${input.index}] skip (exists): ${outputPath}`);
    return {
      index: input.index,
      videoPath: outputPath,
      costUsd: 0,
      elapsedSec: 0,
      retried: false,
      skipped: true,
    };
  }

  const prompt = buildUkiyoeVideoPrompt(input);
  const cameraFixed = resolveCameraFixed(input);
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
        generateAudio,
        cameraFixed,
        log: (m) => log(`scene[${input.index}] ${m}`),
      });
      const bytes = await downloadVideo(videoUrl, outputPath);
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const costUsd = estimateUsdCost({ resolution, duration, generateAudio });
      log(
        `scene[${input.index}] done in ${elapsedSec.toFixed(1)}s (${(bytes / 1024).toFixed(0)}KB, $${costUsd.toFixed(3)})`,
      );
      return {
        index: input.index,
        videoPath: outputPath,
        costUsd,
        elapsedSec,
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
    `scene[${input.index}] failed after retry: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/**
 * 複数シーンを並列で生成。失敗したシーンは個別に throw されるので
 * 呼び出し側で個別リトライ（CLI 側で `--scene N` のみ再走させる等）を想定。
 */
export async function generateUkiyoeVideos(
  scenes: UkiyoeSceneVideoInput[],
  videosDir: string,
  options: GenerateUkiyoeVideosOptions = {},
): Promise<UkiyoeVideoResult[]> {
  ensureFalConfigured();

  const concurrency = Math.max(1, options.concurrency ?? 3);
  const log = options.onProgress ?? ((m: string) => console.log(`[ukiyoe-video] ${m}`));

  await fs.mkdir(videosDir, { recursive: true });

  log(
    `start: ${scenes.length} scenes, concurrency=${concurrency}, dir=${videosDir}`,
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

  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const generated = results.filter((r) => !r.skipped).length;
  log(
    `complete: ${generated}/${results.length} generated, ${results.length - generated} skipped, total $${totalCost.toFixed(3)}`,
  );

  return results;
}
