import path from "node:path";
import { channelDataPath } from "@rekishi/shared/channel";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface UkiyoeJobPaths {
  jobId: string;
  root: string;
  researchMd: string;
  scriptJson: string;
  scenePlanJson: string;
  /** ASR 結果（words.json） */
  wordsJson: string;
  narrationWav: string;
  /** 個別シーンの静止画を置くディレクトリ（scene-00.png 〜 scene-07.png） */
  imagesDir: string;
  /** Seedance で生成した動画クリップを置くディレクトリ（scene-00.mp4 〜 scene-07.mp4） */
  videosDir: string;
  /** ジョブ単位で BGM など override したい時の置き場 */
  assetsDir: string;
  /** UkiyoePlan の最終 JSON */
  planJson: string;
  nextStepsMd: string;
}

export function validateJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      `--job-id は英数字/ハイフン/アンダースコアのみ使えます（got: ${jobId}）`,
    );
  }
}

/**
 * ukiyoe チャンネルのジョブ I/O パスを解決する。
 * `setChannel("ukiyoe")` 済みであることを前提とする
 * （`channelDataPath` は currentChannel を参照するため）。
 */
export function resolveUkiyoeJobPaths(jobId: string): UkiyoeJobPaths {
  validateJobId(jobId);
  const root = channelDataPath("scripts", jobId);
  return {
    jobId,
    root,
    researchMd: path.join(root, "research.md"),
    scriptJson: path.join(root, "script.json"),
    scenePlanJson: path.join(root, "scene-plan.json"),
    wordsJson: path.join(root, "words.json"),
    narrationWav: path.join(root, "narration.wav"),
    imagesDir: path.join(root, "images"),
    videosDir: path.join(root, "videos"),
    assetsDir: path.join(root, "assets"),
    planJson: path.join(root, "ukiyoe-plan.json"),
    nextStepsMd: path.join(root, "NEXT_STEPS.md"),
  };
}

/** scene-XX.png / scene-XX.mp4 の "XX" 部分（0-padded 2 桁）を返す。 */
export function sceneIndexToken(sceneIndex: number): string {
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex > 99) {
    throw new Error(`sceneIndex must be an integer in [0, 99] (got: ${sceneIndex})`);
  }
  return sceneIndex.toString().padStart(2, "0");
}

export function sceneImagePath(
  jobPaths: UkiyoeJobPaths,
  sceneIndex: number,
): string {
  return path.join(jobPaths.imagesDir, `scene-${sceneIndexToken(sceneIndex)}.png`);
}

export function sceneVideoPath(
  jobPaths: UkiyoeJobPaths,
  sceneIndex: number,
): string {
  return path.join(jobPaths.videosDir, `scene-${sceneIndexToken(sceneIndex)}.mp4`);
}
