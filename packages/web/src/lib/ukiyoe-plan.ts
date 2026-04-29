import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { UkiyoePlanSchema, type UkiyoePlan } from "@rekishi/shared";
import { repoRoot } from "./plan";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function ukiyoeJobRoot(jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`invalid jobId: ${jobId}`);
  }
  return path.join(repoRoot(), "data", "ukiyoe", "scripts", jobId);
}

export function ukiyoePlanJsonPath(jobId: string): string {
  return path.join(ukiyoeJobRoot(jobId), "ukiyoe-plan.json");
}

export async function loadUkiyoePlan(jobId: string): Promise<UkiyoePlan> {
  const filepath = ukiyoePlanJsonPath(jobId);
  const raw = await readFile(filepath, "utf-8");
  return UkiyoePlanSchema.parse(JSON.parse(raw));
}

export async function saveUkiyoePlan(
  jobId: string,
  plan: UkiyoePlan,
): Promise<void> {
  const filepath = ukiyoePlanJsonPath(jobId);
  const validated = UkiyoePlanSchema.parse(plan);
  await writeFile(filepath, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

export interface UkiyoeJobSummary {
  jobId: string;
  topic: string;
  totalDurationSec: number;
  sceneCount: number;
}

/**
 * data/ukiyoe/scripts/* を走査し、ukiyoe-plan.json を持つ job を一覧する。
 * homepage で表示するため、見出し情報だけを抽出する。
 */
export async function listUkiyoeJobs(): Promise<UkiyoeJobSummary[]> {
  const scriptsDir = path.join(repoRoot(), "data", "ukiyoe", "scripts");
  let entries: string[];
  try {
    entries = await readdir(scriptsDir);
  } catch {
    return [];
  }

  const jobs: UkiyoeJobSummary[] = [];
  await Promise.all(
    entries.map(async (name) => {
      if (!JOB_ID_PATTERN.test(name)) return;
      const planPath = path.join(scriptsDir, name, "ukiyoe-plan.json");
      try {
        const s = await stat(planPath);
        if (!s.isFile()) return;
      } catch {
        return;
      }
      try {
        const raw = await readFile(planPath, "utf-8");
        const plan = UkiyoePlanSchema.parse(JSON.parse(raw));
        jobs.push({
          jobId: name,
          topic: plan.topic,
          totalDurationSec: plan.totalDurationSec,
          sceneCount: plan.scenes.length,
        });
      } catch {
        // 壊れたプランは silently スキップ（一覧の毒にしない）
      }
    }),
  );

  jobs.sort((a, b) => a.jobId.localeCompare(b.jobId));
  return jobs;
}
