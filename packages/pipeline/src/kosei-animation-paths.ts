import path from "node:path";
import { channelDataPath } from "@rekishi/shared/channel";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface KoseiAnimationJobPaths {
  jobId: string;
  root: string;
  researchMd: string;
  scriptJson: string;
  scenePlanJson: string;
  wordsJson: string;
  narrationWav: string;
  imagesDir: string;
  videosDir: string;
  assetsDir: string;
  planJson: string;
}

export function validateKoseiAnimationJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      `--job-id は英数字/ハイフン/アンダースコアのみ使えます（got: ${jobId}）`,
    );
  }
}

export function resolveKoseiAnimationJobPaths(jobId: string): KoseiAnimationJobPaths {
  validateKoseiAnimationJobId(jobId);
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
    planJson: path.join(root, "kosei-animation-plan.json"),
  };
}

export function sceneIndexToken(sceneIndex: number): string {
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex > 99) {
    throw new Error(`sceneIndex must be an integer in [0, 99] (got: ${sceneIndex})`);
  }
  return sceneIndex.toString().padStart(2, "0");
}

export function sceneImagePath(
  jobPaths: KoseiAnimationJobPaths,
  sceneIndex: number,
): string {
  return path.join(jobPaths.imagesDir, `scene-${sceneIndexToken(sceneIndex)}.png`);
}

export function sceneVideoPath(
  jobPaths: KoseiAnimationJobPaths,
  sceneIndex: number,
): string {
  return path.join(jobPaths.videosDir, `scene-${sceneIndexToken(sceneIndex)}.mp4`);
}
