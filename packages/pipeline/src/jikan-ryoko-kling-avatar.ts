/**
 * jikan-ryoko: Kling AI Avatar 2.0 ラッパー。
 *
 * 入力: 画像 + 音声ファイル → 出力: キャラがその音声を喋る動画 (リップシンク付き)
 *
 * fal.ai endpoints:
 *   fal-ai/kling-video/ai-avatar/v2/standard  ($0.0562/s)
 *   fal-ai/kling-video/ai-avatar/v2/pro       ($0.115/s)
 *
 * 既存 ukiyoe-video-generator.ts (Seedance) と同じ fal.subscribe パターンに揃えてある。
 */
import { fal } from "@fal-ai/client";
import fs from "node:fs/promises";
import path from "node:path";

export type KlingAvatarTier = "standard" | "pro";

const ENDPOINTS: Record<KlingAvatarTier, string> = {
  standard: "fal-ai/kling-video/ai-avatar/v2/standard",
  pro: "fal-ai/kling-video/ai-avatar/v2/pro",
};

const PRICE_USD_PER_SEC: Record<KlingAvatarTier, number> = {
  standard: 0.0562,
  pro: 0.115,
};

export interface KlingAvatarInput {
  imagePath: string;
  audioPath: string;
  /** 既定 standard（試作用に安い方） */
  tier?: KlingAvatarTier;
  /** 任意のプロンプト微調整（モーション指示など）。null/空でも OK */
  prompt?: string;
  log?: (msg: string) => void;
}

export interface KlingAvatarResult {
  videoPath: string;
  bytes: number;
  /** 課金対象になる秒数（音声長 ≒ 動画長） */
  audioDurationSec: number;
  estimatedUsd: number;
}

interface RawKlingResult {
  data?: { video?: { url?: string } };
}

function ensureFalConfigured(): void {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      "FAL_KEY is not set in .env.local — add it before generating jikan-ryoko videos.",
    );
  }
  fal.config({ credentials: key });
}

function mimeForPath(p: string): string {
  const ext = path.extname(p).slice(1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "wav") return "audio/wav";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "aac") return "audio/aac";
  if (ext === "ogg") return "audio/ogg";
  return "application/octet-stream";
}

async function uploadAsset(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const file = new File([buffer], path.basename(filePath), {
    type: mimeForPath(filePath),
  });
  return fal.storage.upload(file);
}

async function downloadVideo(url: string, outPath: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kling Avatar video download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
  return buf.byteLength;
}

/**
 * Kling AI Avatar 2.0 で「画像のキャラが音声を喋る」動画を生成する。
 * 出力は MP4。動画長は音声長に追従する。
 */
export async function generateKlingAvatarVideo(
  input: KlingAvatarInput,
  destPath: string,
  audioDurationSec: number,
): Promise<KlingAvatarResult> {
  ensureFalConfigured();

  const tier = input.tier ?? "standard";
  const log = input.log ?? (() => {});

  log(`[kling-avatar] uploading image: ${input.imagePath}`);
  const imageUrl = await uploadAsset(input.imagePath);
  log(`[kling-avatar] uploading audio: ${input.audioPath}`);
  const audioUrl = await uploadAsset(input.audioPath);

  const endpoint = ENDPOINTS[tier];
  log(`[kling-avatar] calling ${endpoint} (audio ~${audioDurationSec.toFixed(2)}s)`);

  const result = (await fal.subscribe(endpoint, {
    input: {
      image_url: imageUrl,
      audio_url: audioUrl,
      ...(input.prompt ? { prompt: input.prompt } : {}),
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        update.logs?.forEach((l) => log(`[kling-avatar] ${l.message}`));
      }
    },
  })) as RawKlingResult;

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error("Kling Avatar response missing video.url");
  }
  log(`[kling-avatar] downloading: ${videoUrl}`);
  const bytes = await downloadVideo(videoUrl, destPath);
  const estimatedUsd = audioDurationSec * PRICE_USD_PER_SEC[tier];
  return {
    videoPath: destPath,
    bytes,
    audioDurationSec,
    estimatedUsd,
  };
}
