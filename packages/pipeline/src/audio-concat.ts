import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * 複数 WAV を ffmpeg concat demuxer + `-c copy` で連結する。
 *
 * `-c copy` を使うため、入力 WAV はサンプリングレート / チャンネル数 / コーデックが
 * 揃っている必要がある。同一 TTS プロバイダ (例: Gemini) からの出力なら通常揃う。
 */
export async function ffmpegConcatWavs(
  inputs: string[],
  outPath: string,
): Promise<void> {
  if (inputs.length === 0) {
    throw new Error("ffmpegConcatWavs: inputs is empty");
  }
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "audio-concat-"));
  const listFile = path.join(tmpDir, "list.txt");
  const body = inputs
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fsp.writeFile(listFile, body, "utf-8");

  try {
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      outPath,
    ]);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });
}
