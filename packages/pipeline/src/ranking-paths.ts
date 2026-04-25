import fs from "node:fs";
import path from "node:path";
import { channelDataPath } from "@rekishi/shared/channel";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const IMAGE_EXTENSIONS = ["png", "webp", "jpg", "jpeg"] as const;

export interface RankingJobPaths {
  jobId: string;
  root: string;
  scriptJson: string;
  nextStepsMd: string;
  planJson: string;
  assetsDir: string;
  narrationWav: string;
}

export function validateJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      `--job-id は英数字/ハイフン/アンダースコアのみ使えます（got: ${jobId}）`,
    );
  }
}

export function resolveRankingJobPaths(jobId: string): RankingJobPaths {
  validateJobId(jobId);
  const root = channelDataPath("scripts", jobId);
  return {
    jobId,
    root,
    scriptJson: path.join(root, "script.json"),
    nextStepsMd: path.join(root, "NEXT_STEPS.md"),
    planJson: path.join(root, "ranking-plan.json"),
    assetsDir: path.join(root, "assets"),
    narrationWav: path.join(root, "narration.wav"),
  };
}

export function findAssetByBasename(dir: string, basename: string): string | null {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(dir, `${basename}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export interface RankingAssetResolution {
  itemImages: [string, string, string];
  backgroundImage: string;
  missing: string[];
}

export function resolveRankingAssets(
  assetsDir: string,
): RankingAssetResolution {
  const missing: string[] = [];
  const itemPaths: string[] = [];
  for (let rank = 1; rank <= 3; rank++) {
    const basename = `item-${rank}`;
    const p = findAssetByBasename(assetsDir, basename);
    if (p) {
      itemPaths.push(p);
    } else {
      missing.push(basename);
      itemPaths.push("");
    }
  }
  const bg = findAssetByBasename(assetsDir, "background");
  if (!bg) missing.push("background");

  return {
    itemImages: [itemPaths[0]!, itemPaths[1]!, itemPaths[2]!],
    backgroundImage: bg ?? "",
    missing,
  };
}

export const IMAGE_EXTENSION_LIST = IMAGE_EXTENSIONS;
