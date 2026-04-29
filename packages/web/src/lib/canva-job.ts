import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  ManabilabCanvaJobSchema,
  ManabilabCanvaScriptSchema,
  ManabilabCanvaScenesSchema,
  type ManabilabCanvaJob,
  type ManabilabCanvaScene,
  type ManabilabCanvaScript,
  type StepKey,
  type Topic,
} from "@rekishi/shared";

export const CANVA_CHANNEL_SLUG = "manabilab-canva";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

export function jobsRootDir(): string {
  return path.join(
    REPO_ROOT,
    "packages",
    "channels",
    CANVA_CHANNEL_SLUG,
    "jobs",
  );
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

export function researchPromptPath(): string {
  return path.join(
    REPO_ROOT,
    "packages",
    "channels",
    CANVA_CHANNEL_SLUG,
    "prompts",
    "research.md",
  );
}

export async function readResearchPromptTemplate(): Promise<string> {
  return readFile(researchPromptPath(), "utf-8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugifyTitle(title: string): string {
  // ASCII 英数のみで slug を作る（URL/path セーフ）。
  // 日本語タイトルなど ASCII が含まれない場合は空文字を返す。
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function generateJobId(title: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugifyTitle(title);
  // jobId は URL/ファイル名で扱うため必ず ASCII-safe にする。
  // 日本語のみのタイトルはランダムサフィックスでフォールバック。
  return slug ? `mlc-${date}-${slug}` : `mlc-${date}-${randomSuffix()}`;
}

export function emptyJob(jobId: string, topic: Topic): ManabilabCanvaJob {
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
      images: { status: "pending" },
      tts: { status: "pending" },
      export: { status: "pending" },
    },
  };
}

export async function createJob(topic: Topic): Promise<ManabilabCanvaJob> {
  const jobId = generateJobId(topic.title);
  const dir = jobDir(jobId);
  await mkdir(dir, { recursive: true });

  // 衝突回避: 既に同名ジョブがあれば連番をつける
  let finalId = jobId;
  let suffix = 2;
  while (await exists(jobJsonPath(finalId))) {
    finalId = `${jobId}-${suffix}`;
    await mkdir(jobDir(finalId), { recursive: true });
    suffix += 1;
  }

  const job = emptyJob(finalId, topic);
  await saveJob(job);
  return job;
}

export async function loadJob(jobId: string): Promise<ManabilabCanvaJob> {
  const raw = await readFile(jobJsonPath(jobId), "utf-8");
  const parsed = JSON.parse(raw);
  return ManabilabCanvaJobSchema.parse(parsed);
}

export async function saveJob(job: ManabilabCanvaJob): Promise<void> {
  const next: ManabilabCanvaJob = { ...job, updatedAt: nowIso() };
  await mkdir(jobDir(next.id), { recursive: true });
  await writeFile(
    jobJsonPath(next.id),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf-8",
  );
}

export async function listJobs(): Promise<ManabilabCanvaJob[]> {
  const root = jobsRootDir();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const jobs: ManabilabCanvaJob[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const dir = path.join(root, entry);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
      const job = await loadJob(entry);
      jobs.push(job);
    } catch {
      // 壊れた job.json は無視
    }
  }
  jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return jobs;
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
): Promise<ManabilabCanvaScript | null> {
  try {
    const raw = await readFile(scriptJsonPath(jobId), "utf-8");
    const parsed = ManabilabCanvaScriptSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null; // 旧フォーマットなどは null 扱いで再生成を促す
    return parsed.data;
  } catch {
    return null;
  }
}

export async function writeScriptJson(
  jobId: string,
  script: ManabilabCanvaScript,
): Promise<void> {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(
    scriptJsonPath(jobId),
    `${JSON.stringify(script, null, 2)}\n`,
    "utf-8",
  );
}

export async function readScenesJson(
  jobId: string,
): Promise<ManabilabCanvaScene[] | null> {
  try {
    const raw = await readFile(scenesJsonPath(jobId), "utf-8");
    const parsed = ManabilabCanvaScenesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return parsed.data.scenes;
  } catch {
    return null;
  }
}

export async function writeScenesJson(
  jobId: string,
  scenes: ManabilabCanvaScene[],
): Promise<void> {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(
    scenesJsonPath(jobId),
    `${JSON.stringify({ scenes }, null, 2)}\n`,
    "utf-8",
  );
}

export async function updateStep<K extends StepKey>(
  jobId: string,
  step: K,
  patch: Partial<ManabilabCanvaJob["steps"][K]>,
): Promise<ManabilabCanvaJob> {
  const job = await loadJob(jobId);
  const prev = job.steps[step] as ManabilabCanvaJob["steps"][K];
  const next: ManabilabCanvaJob = {
    ...job,
    steps: {
      ...job.steps,
      [step]: { ...prev, ...patch, updatedAt: nowIso() },
    },
  };
  await saveJob(next);
  return next;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
