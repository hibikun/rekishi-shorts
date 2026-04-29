import path from "node:path";
import {
  callSeedance,
  downloadVideo,
  ensureFalConfigured,
} from "./ukiyoe-video-generator.js";

export interface GenerateAnimationOptions {
  /** 9:16 の静止画。Seedance に img2video の入力として渡す */
  imagePath: string;
  /** 出力先 mp4 の絶対パス */
  outputPath: string;
  /** 英語アニメプロンプト */
  prompt: string;
  /** 動画解像度。default 720p */
  resolution?: "480p" | "720p";
  /** 5〜12 秒。default 5 */
  durationSec?: number;
  /** 進捗ログ */
  onProgress?: (msg: string) => void;
}

export interface GenerateAnimationResult {
  outputPath: string;
  bytes: number;
  resolution: "480p" | "720p";
  durationSec: number;
}

/**
 * 静止画 1 枚 + 英語プロンプトから Seedance V1 Lite で 5 秒の mp4 を生成する。
 * ukiyoe-video-generator の callSeedance / downloadVideo を流用するだけの薄いラッパー。
 */
export async function generateAnimationForScene(
  options: GenerateAnimationOptions,
): Promise<GenerateAnimationResult> {
  const log =
    options.onProgress ??
    ((m: string) => console.log(`[manabilab-canva-video] ${m}`));
  const resolution = options.resolution ?? "720p";
  const durationSec = options.durationSec ?? 5;

  ensureFalConfigured();
  log(
    `seedance start: ${path.basename(options.imagePath)} → ${path.basename(
      options.outputPath,
    )} (${resolution}, ${durationSec}s)`,
  );

  const { videoUrl } = await callSeedance({
    imagePath: options.imagePath,
    prompt: options.prompt,
    resolution,
    aspectRatio: "9:16",
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
