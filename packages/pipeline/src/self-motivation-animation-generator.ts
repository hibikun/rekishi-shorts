import path from "node:path";
import {
  callSeedance,
  downloadVideo,
  ensureFalConfigured,
} from "./ukiyoe-video-generator.js";

export interface GenerateLongformAnimationOptions {
  /** 16:9 の元画像（絶対パス）。Seedance に img2video 入力として渡す */
  imagePath: string;
  /** 出力先 mp4 の絶対パス */
  outputPath: string;
  /** 英語アニメプロンプト */
  prompt: string;
  /** 解像度。default 720p */
  resolution?: "480p" | "720p";
  /** 5〜12 秒。default 5 */
  durationSec?: number;
  /** 進捗ログ */
  onProgress?: (msg: string) => void;
}

export interface GenerateLongformAnimationResult {
  outputPath: string;
  bytes: number;
  resolution: "480p" | "720p";
  durationSec: number;
}

/**
 * 16:9 の静止画 1 枚 + 英語プロンプトから Seedance V1 Lite で短い mp4 を生成する。
 * ukiyoe / manabilab-canva の同等関数 (9:16 固定) とは独立に持つことで、
 * self-motivation の long-form (16:9) 用に aspectRatio を固定する。
 */
export async function generateLongformAnimation(
  options: GenerateLongformAnimationOptions,
): Promise<GenerateLongformAnimationResult> {
  const log =
    options.onProgress ??
    ((m: string) => console.log(`[self-motivation-video] ${m}`));
  const resolution = options.resolution ?? "720p";
  const durationSec = options.durationSec ?? 5;

  ensureFalConfigured();
  log(
    `seedance start: ${path.basename(options.imagePath)} → ${path.basename(
      options.outputPath,
    )} (${resolution}, ${durationSec}s, 16:9)`,
  );

  const { videoUrl } = await callSeedance({
    imagePath: options.imagePath,
    prompt: options.prompt,
    resolution,
    aspectRatio: "16:9",
    duration: durationSec,
    log,
  });

  const bytes = await downloadVideo(videoUrl, options.outputPath);
  log(`seedance done: ${(bytes / 1024).toFixed(0)} KB`);

  return {
    outputPath: options.outputPath,
    bytes,
    resolution,
    durationSec,
  };
}
