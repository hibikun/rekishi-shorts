import { fal } from "@fal-ai/client";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { KoseiAnimationMotionTag } from "@rekishi/shared";

const SEEDANCE_MODEL = "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";

const STYLE_SUFFIX =
  "Maintain photorealistic scientific paleoart style. Keep motion natural, restrained, and documentary-like. Avoid fantasy monster behavior, movie franchise resemblance, gore, labels, and text.";

interface MotionTagDef {
  prompt: string;
  cameraFixed: boolean;
}

const MOTION_TAG_PROMPTS: Record<KoseiAnimationMotionTag, MotionTagDef> = {
  breathing_idle: {
    prompt: "The animal breathes naturally with subtle chest, neck, and skin movement.",
    cameraFixed: true,
  },
  subtle_head_turn: {
    prompt: "The animal slowly turns its head with small eye and neck movement.",
    cameraFixed: true,
  },
  slow_walk: {
    prompt: "The animal walks slowly and heavily through the environment with realistic body weight.",
    cameraFixed: false,
  },
  mouth_open_close: {
    prompt: "The animal opens and closes its mouth naturally without exaggerated aggression.",
    cameraFixed: true,
  },
  feeding_motion: {
    prompt: "The animal makes a restrained feeding or chewing motion that matches the scene.",
    cameraFixed: true,
  },
  tail_body_motion: {
    prompt: "The body shifts subtly and the tail moves with natural balance.",
    cameraFixed: true,
  },
  environment_motion: {
    prompt: "The environment moves naturally: wind, water, dust, foliage, or light changes.",
    cameraFixed: true,
  },
  fossil_camera_push: {
    prompt: "The camera slowly pushes toward the fossil or skeleton display with museum lighting.",
    cameraFixed: false,
  },
  detail_camera_push: {
    prompt: "The camera slowly pushes toward the anatomical detail while keeping it sharp.",
    cameraFixed: false,
  },
  still_subtle: {
    prompt: "Very subtle camera push-in and slight ambient movement, no dramatic action.",
    cameraFixed: true,
  },
};

export interface KoseiAnimationSceneVideoInput {
  index: number;
  imagePath: string;
  scenePrompt: string;
  motionTag?: KoseiAnimationMotionTag;
  cameraFixed?: boolean;
  duration?: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
}

export interface KoseiAnimationVideoResult {
  index: number;
  videoPath: string;
  costUsd: number;
  elapsedSec: number;
  retried: boolean;
  skipped: boolean;
}

export interface GenerateKoseiAnimationVideosOptions {
  concurrency?: number;
  skipExisting?: boolean;
  resolution?: "480p" | "720p";
  aspectRatio?: "9:16" | "16:9";
  generateAudio?: boolean;
  onProgress?: (msg: string) => void;
}

export function buildKoseiAnimationVideoPrompt(
  input: KoseiAnimationSceneVideoInput,
): string {
  const tag = input.motionTag ?? "still_subtle";
  return [input.scenePrompt, MOTION_TAG_PROMPTS[tag].prompt, STYLE_SUFFIX]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

export function resolveKoseiAnimationCameraFixed(
  input: KoseiAnimationSceneVideoInput,
): boolean {
  if (input.cameraFixed !== undefined) return input.cameraFixed;
  const tag = input.motionTag ?? "still_subtle";
  return MOTION_TAG_PROMPTS[tag].cameraFixed;
}

function ensureFalConfigured(): void {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      "FAL_KEY is not set in .env.local — add it before generating kosei-animation videos.",
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
  if (!videoUrl) throw new Error("Seedance response missing video.url");
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

export async function generateOneKoseiAnimationVideo(
  input: KoseiAnimationSceneVideoInput,
  outputPath: string,
  options: GenerateKoseiAnimationVideosOptions = {},
): Promise<KoseiAnimationVideoResult> {
  ensureFalConfigured();

  const log =
    options.onProgress ?? ((m: string) => console.log(`[kosei-animation-video] ${m}`));
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

  const prompt = buildKoseiAnimationVideoPrompt(input);
  const cameraFixed = resolveKoseiAnimationCameraFixed(input);
  const startedAt = Date.now();

  let retried = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      log(
        `scene[${input.index}] submit (attempt=${attempt + 1}, motion=${input.motionTag ?? "still_subtle"})`,
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
      retried = true;
      log(
        `scene[${input.index}] error (attempt=${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    `scene[${input.index}] failed after retry: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

export async function generateKoseiAnimationVideos(
  scenes: KoseiAnimationSceneVideoInput[],
  videosDir: string,
  options: GenerateKoseiAnimationVideosOptions = {},
): Promise<KoseiAnimationVideoResult[]> {
  ensureFalConfigured();

  const concurrency = Math.max(1, options.concurrency ?? 3);
  const log =
    options.onProgress ?? ((m: string) => console.log(`[kosei-animation-video] ${m}`));
  await fs.mkdir(videosDir, { recursive: true });
  log(`start: ${scenes.length} scenes, concurrency=${concurrency}, dir=${videosDir}`);

  const results: KoseiAnimationVideoResult[] = new Array(scenes.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < scenes.length) {
      const i = cursor++;
      const scene = scenes[i]!;
      const outPath = path.join(
        videosDir,
        `scene-${scene.index.toString().padStart(2, "0")}.mp4`,
      );
      results[i] = await generateOneKoseiAnimationVideo(scene, outPath, {
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
