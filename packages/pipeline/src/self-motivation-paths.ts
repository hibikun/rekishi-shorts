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

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * YouTube URL から videoId (11 文字) を抽出する。
 * 対応形式: https://www.youtube.com/watch?v=ID, https://youtu.be/ID,
 * https://www.youtube.com/embed/ID, https://www.youtube.com/shorts/ID,
 * https://www.youtube.com/live/ID, m.youtube.com も同様。
 * 抽出できない場合は null。
 */
export function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") {
    return null;
  }

  const v = url.searchParams.get("v");
  if (v && YOUTUBE_VIDEO_ID_PATTERN.test(v)) return v;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const head = segments[0] ?? "";
    const id = segments[1] ?? "";
    if (
      (head === "embed" ||
        head === "shorts" ||
        head === "live" ||
        head === "v") &&
      YOUTUBE_VIDEO_ID_PATTERN.test(id)
    ) {
      return id;
    }
  }
  return null;
}

export function normalizeYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeTranscriptMdPath(jobId: string, videoId: string): string {
  return path.join(jobDir(jobId), `youtube-${videoId}.md`);
}

export function generateRefId(): string {
  return Math.random().toString(36).slice(2, 10).padStart(8, "0");
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
