import fsp from "node:fs/promises";
import path from "node:path";
import { ffmpegConcatWavs, runFfmpeg } from "./audio-concat.js";

export interface SelfMotivationTtsConcatInput {
  sceneId: string;
  audioPath: string;
}

export interface SelfMotivationTtsConcatResult {
  outputPath: string;
  totalDurationSec: number;
}

/**
 * Scene 別 wav を順序通りに 1 本に結合する。
 *
 * 内部実装は ffmpeg concat demuxer + `-c copy`。サンプリングレート / チャンネル数は
 * Gemini TTS から落ちる wav が揃っている前提。揃わない場合は -c copy が失敗するので、
 * フォールバックとして re-encode コードパスも用意している。
 */
export async function concatSelfMotivationTts(
  inputs: SelfMotivationTtsConcatInput[],
  outputPath: string,
): Promise<SelfMotivationTtsConcatResult> {
  if (inputs.length === 0) {
    throw new Error("concatSelfMotivationTts: inputs is empty");
  }
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  const paths = inputs.map((i) => i.audioPath);
  try {
    await ffmpegConcatWavs(paths, outputPath);
  } catch (err) {
    // -c copy で失敗した場合は decode → re-encode で揃え直す。
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!/Non-monotonous DTS|sample rate|channel layout/i.test(errMsg)) {
      throw err;
    }
    await reencodeAndConcat(paths, outputPath);
  }

  const probe = await runFfprobeDuration(outputPath);
  return { outputPath, totalDurationSec: probe };
}

async function reencodeAndConcat(
  inputs: string[],
  outputPath: string,
): Promise<void> {
  // 全入力を 1 つのフィルタチェーンに concat する
  const ffArgs: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const p of inputs) {
    ffArgs.push("-i", p);
  }
  const filter = `${inputs.map((_, i) => `[${i}:a]`).join("")}concat=n=${inputs.length}:v=0:a=1[out]`;
  ffArgs.push("-filter_complex", filter, "-map", "[out]", outputPath);
  await runFfmpeg(ffArgs);
}

async function runFfprobeDuration(filePath: string): Promise<number> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}`));
        return;
      }
      const dur = parseFloat(stdout.trim());
      if (Number.isFinite(dur) && dur > 0) resolve(dur);
      else reject(new Error(`ffprobe returned invalid duration: ${stdout}`));
    });
  });
}
