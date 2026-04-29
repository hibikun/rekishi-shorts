import path from "node:path";
import { channelPackageDir } from "@rekishi/shared/channel";

export const SELF_MOTIVATION_CHANNEL = "self-motivation";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      `jobId は英数字 / ハイフン / アンダースコアのみ使えます (got: ${jobId})`,
    );
  }
}

export function channelRootDir(): string {
  return channelPackageDir(SELF_MOTIVATION_CHANNEL);
}

export function jobsRootDir(): string {
  return path.join(channelRootDir(), "jobs");
}

export function jobDir(jobId: string): string {
  return path.join(jobsRootDir(), jobId);
}

export function jobJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "job.json");
}

export function researchMdPath(jobId: string): string {
  return path.join(jobDir(jobId), "research.md");
}

export function scriptJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "script.json");
}

export function scenesJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "scenes.json");
}

export function imagesDir(jobId: string): string {
  return path.join(jobDir(jobId), "images");
}

export function audioDir(jobId: string): string {
  return path.join(jobDir(jobId), "audio");
}

export function renderDir(jobId: string): string {
  return path.join(jobDir(jobId), "render");
}

export function sceneImagePath(jobId: string, sceneId: string): string {
  return path.join(imagesDir(jobId), `${sceneId}.png`);
}

export function sceneAudioPath(jobId: string, sceneId: string): string {
  return path.join(audioDir(jobId), `${sceneId}.wav`);
}

export function concatAudioPath(jobId: string): string {
  return path.join(audioDir(jobId), "full.wav");
}

export function renderOutputPath(jobId: string): string {
  return path.join(renderDir(jobId), "output.mp4");
}

export function renderStatusPath(jobId: string): string {
  return path.join(renderDir(jobId), "status.json");
}

export function defaultBgmPath(): string {
  return path.join(channelRootDir(), "assets", "bgm", "default.mp3");
}

export function promptFilePath(name: string): string {
  return path.join(channelRootDir(), "prompts", `${name}.md`);
}

/**
 * 絶対パスをチャンネルルート起点の相対パスに変換する。
 * scenes.json / job.json に格納する用途。
 */
export function relFromChannelRoot(absPath: string): string {
  return path.relative(channelRootDir(), absPath);
}

/**
 * 8 文字の base36 ID を生成する。Scene の sceneId 用途。
 * Math.random ベース（セキュリティ要件は無いので暗号強度は不要）。
 */
export function generateSceneId(): string {
  return Math.random().toString(36).slice(2, 10).padStart(8, "0");
}
