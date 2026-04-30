import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  UkiyoeJobSchema,
  UkiyoeScenePlanSchema,
  UkiyoeScriptSchema,
  type UkiyoeJob,
  type UkiyoeScenePlan,
  type UkiyoeScript,
  type UkiyoeStepKey,
  type UkiyoeTopic,
} from "@rekishi/shared";
import { repoRoot } from "./plan";

export const UKIYOE_CHANNEL_SLUG = "ukiyoe";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function jobsRootDir(): string {
  return path.join(repoRoot(), "data", UKIYOE_CHANNEL_SLUG, "scripts");
}

export function jobDir(jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`invalid jobId: ${jobId}`);
  }
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

export function scenePlanJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "scene-plan.json");
}

export function imagesDir(jobId: string): string {
  return path.join(jobDir(jobId), "images");
}

export function videosDir(jobId: string): string {
  return path.join(jobDir(jobId), "videos");
}

export function narrationWavPath(jobId: string): string {
  return path.join(jobDir(jobId), "narration.wav");
}

export function wordsJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "words.json");
}

export function ukiyoePlanJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "ukiyoe-plan.json");
}

export function metaDraftPath(jobId: string): string {
  return path.join(jobDir(jobId), "meta-draft.md");
}

export function metaJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "meta.json");
}

export function uploadJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "upload.json");
}

export function finalVideoPath(jobId: string): string {
  return path.join(repoRoot(), "data", UKIYOE_CHANNEL_SLUG, "videos", `${jobId}.mp4`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function generateJobId(topic: UkiyoeTopic): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugifyTitle(topic.person ?? topic.title);
  const base = slug
    ? `ukiyoe-${topic.mode}-${slug}-${date}`
    : `ukiyoe-${topic.mode}-${date}-${randomSuffix()}`;
  return base;
}

export function emptyJob(jobId: string, topic: UkiyoeTopic): UkiyoeJob {
  const now = nowIso();
  return {
    id: jobId,
    createdAt: now,
    updatedAt: now,
    topic,
    steps: {
      topic: { status: "done", updatedAt: now },
      research: { status: "pending", sources: [], queries: [] },
      script: { status: "pending" },
      scenes: { status: "pending" },
      images: { status: "pending", generatedScenes: [] },
      tts: { status: "pending", voiceProvider: "gemini", voiceName: "Charon" },
      videos: { status: "pending", generatedScenes: [] },
      render: { status: "pending" },
      ship: { status: "pending" },
    },
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function createJob(topic: UkiyoeTopic): Promise<UkiyoeJob> {
  let id = generateJobId(topic);
  let suffix = 2;
  while (await fileExists(jobJsonPath(id))) {
    id = `${generateJobId(topic)}-${suffix}`;
    suffix += 1;
  }
  await mkdir(jobDir(id), { recursive: true });
  const job = emptyJob(id, topic);
  await saveJob(job);
  return job;
}

export async function loadJob(jobId: string): Promise<UkiyoeJob> {
  const raw = await readFile(jobJsonPath(jobId), "utf-8");
  return UkiyoeJobSchema.parse(JSON.parse(raw));
}

export async function saveJob(job: UkiyoeJob): Promise<void> {
  const next: UkiyoeJob = { ...job, updatedAt: nowIso() };
  await mkdir(jobDir(next.id), { recursive: true });
  await writeFile(
    jobJsonPath(next.id),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf-8",
  );
}

export async function listJobs(): Promise<UkiyoeJob[]> {
  const root = jobsRootDir();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const jobs: UkiyoeJob[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (!JOB_ID_PATTERN.test(entry)) continue;
    const dir = path.join(root, entry);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
      if (!(await fileExists(jobJsonPath(entry)))) continue;
      jobs.push(await loadJob(entry));
    } catch {
      // 壊れた job.json は silently skip
    }
  }
  jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return jobs;
}

export async function updateStep<K extends UkiyoeStepKey>(
  jobId: string,
  step: K,
  patch: Partial<UkiyoeJob["steps"][K]>,
): Promise<UkiyoeJob> {
  const job = await loadJob(jobId);
  const prev = job.steps[step] as UkiyoeJob["steps"][K];
  const next: UkiyoeJob = {
    ...job,
    steps: {
      ...job.steps,
      [step]: { ...prev, ...patch, updatedAt: nowIso() },
    },
  };
  await saveJob(next);
  return next;
}

export async function readResearchMarkdown(jobId: string): Promise<string> {
  try {
    return await readFile(researchMdPath(jobId), "utf-8");
  } catch {
    return "";
  }
}

export async function writeResearchMarkdown(
  jobId: string,
  markdown: string,
): Promise<void> {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(researchMdPath(jobId), markdown, "utf-8");
}

export async function readScriptJson(
  jobId: string,
): Promise<UkiyoeScript | null> {
  try {
    const raw = await readFile(scriptJsonPath(jobId), "utf-8");
    const parsed = UkiyoeScriptSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function writeScriptJson(
  jobId: string,
  script: UkiyoeScript,
): Promise<void> {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(
    scriptJsonPath(jobId),
    `${JSON.stringify(script, null, 2)}\n`,
    "utf-8",
  );
}

export async function readScenePlanJson(
  jobId: string,
): Promise<UkiyoeScenePlan | null> {
  try {
    const raw = await readFile(scenePlanJsonPath(jobId), "utf-8");
    const parsed = UkiyoeScenePlanSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function writeScenePlanJson(
  jobId: string,
  plan: UkiyoeScenePlan,
): Promise<void> {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(
    scenePlanJsonPath(jobId),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf-8",
  );
}

export async function readMetaDraft(jobId: string): Promise<string> {
  try {
    return await readFile(metaDraftPath(jobId), "utf-8");
  } catch {
    return "";
  }
}

export async function writeMetaDraft(jobId: string, md: string): Promise<void> {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(metaDraftPath(jobId), md, "utf-8");
}
