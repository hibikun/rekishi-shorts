/**
 * jikan-ryoko: Seedance 2.0 fast (image-to-video, native audio + lip-sync) ラッパー。
 *
 * Chloe VS History が使う「単発で動画+音声+リップシンクを生成」アーキテクチャ。
 * ukiyoe チャンネルの Seedance 1.5 Pro (no audio) とは別 endpoint・別目的のため、
 * 意図的に独立ファイルとして実装している（共通化はしない）。
 *
 * fal.ai endpoints:
 *   bytedance/seedance-2.0/image-to-video       (standard, 720p)
 *   bytedance/seedance-2.0/fast/image-to-video  (fast, 480p→720p upscale)
 */
import { fal } from "@fal-ai/client";
import fs from "node:fs/promises";
import path from "node:path";

export type SeedanceTier = "standard" | "fast";

const ENDPOINTS: Record<SeedanceTier, string> = {
  standard: "bytedance/seedance-2.0/image-to-video",
  fast: "bytedance/seedance-2.0/fast/image-to-video",
};

// fal.ai 公開ページ time of writing では per-second pricing 未掲載。
// 一般情報ベース (Seedance 2.0 standard ~$0.30/s, fast ~$0.24/s, 720p+audio) で見積もる。
const PRICE_USD_PER_SEC: Record<SeedanceTier, number> = {
  standard: 0.30,
  fast: 0.24,
};

export type SeedanceResolution = "480p" | "720p" | "1080p";
export type SeedanceAspectRatio =
  | "auto"
  | "21:9"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16";

export interface SeedanceVideoInput {
  /** 起点フレーム画像（PNG/JPEG/WebP, 30MB 以下） */
  imagePath: string;
  /** 動き・台詞・音声指示を含むプロンプト */
  prompt: string;
  /** 既定 fast（試作用に安い方） */
  tier?: SeedanceTier;
  /** 4〜15 秒。既定 5 */
  duration?: number;
  /** 既定 720p */
  resolution?: SeedanceResolution;
  /** 既定 9:16（縦動画） */
  aspectRatio?: SeedanceAspectRatio;
  /** 音声+リップシンクを生成するか。既定 true */
  generateAudio?: boolean;
  /** 再現性用 seed */
  seed?: number;
  log?: (msg: string) => void;
}

export interface SeedanceVideoResult {
  videoPath: string;
  bytes: number;
  durationSec: number;
  estimatedUsd: number;
  seed?: number;
}

interface RawSeedanceResult {
  data?: {
    video?: { url?: string };
    seed?: number;
  };
}

function ensureFalConfigured(): void {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      "FAL_KEY is not set in .env.local — add it before generating jikan-ryoko Seedance videos.",
    );
  }
  fal.config({ credentials: key });
}

function mimeForImage(p: string): string {
  const ext = path.extname(p).slice(1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

async function uploadImage(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const file = new File([buffer], path.basename(filePath), {
    type: mimeForImage(filePath),
  });
  return fal.storage.upload(file);
}

async function downloadVideo(url: string, outPath: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Seedance 2.0 video download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
  return buf.byteLength;
}

/**
 * Seedance 2.0 image-to-video で「画像を起点に、台詞付きの動画」を生成する。
 * デフォルトで `generate_audio: true`（音声・リップシンクを Seedance がネイティブ生成）。
 */
export async function generateSeedanceVideo(
  input: SeedanceVideoInput,
  destPath: string,
): Promise<SeedanceVideoResult> {
  ensureFalConfigured();

  const tier = input.tier ?? "fast";
  const duration = input.duration ?? 5;
  const resolution = input.resolution ?? "720p";
  const aspectRatio = input.aspectRatio ?? "9:16";
  const generateAudio = input.generateAudio ?? true;
  const log = input.log ?? (() => {});

  log(`[seedance-2.0] uploading image: ${input.imagePath}`);
  const imageUrl = await uploadImage(input.imagePath);

  const endpoint = ENDPOINTS[tier];
  log(
    `[seedance-2.0] calling ${endpoint} (duration=${duration}s, ${resolution}, audio=${generateAudio})`,
  );

  const result = (await fal.subscribe(endpoint, {
    input: {
      image_url: imageUrl,
      prompt: input.prompt,
      // Seedance 2.0 image-to-video: duration は文字列 ("4"〜"15" または "auto")。
      duration: String(duration),
      resolution,
      aspect_ratio: aspectRatio,
      generate_audio: generateAudio,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        update.logs?.forEach((l) => log(`[seedance-2.0] ${l.message}`));
      }
    },
  })) as RawSeedanceResult;

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error("Seedance 2.0 response missing video.url");
  }

  log(`[seedance-2.0] downloading: ${videoUrl}`);
  const bytes = await downloadVideo(videoUrl, destPath);
  const estimatedUsd = duration * PRICE_USD_PER_SEC[tier];

  return {
    videoPath: destPath,
    bytes,
    durationSec: duration,
    estimatedUsd,
    seed: result.data?.seed,
  };
}
