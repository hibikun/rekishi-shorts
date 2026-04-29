import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import {
  SELF_MOTIVATION_STEP_ORDER,
  SelfMotivationJobSchema,
  SelfMotivationScenesSchema,
  SelfMotivationScriptSchema,
  type SelfMotivationJob,
  type SelfMotivationScene,
  type SelfMotivationScript,
  type SelfMotivationStepKey,
  type SelfMotivationYoutubeRef,
  type Topic,
} from "@rekishi/shared";
import {
  jobDir,
  jobJsonPath,
  jobsRootDir,
  researchMdPath,
  scenesJsonPath,
  scriptJsonPath,
  youtubeTranscriptMdPath,
} from "./self-motivation-paths.js";

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

export function generateJobId(title: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugifyTitle(title);
  return slug ? `sm-${date}-${slug}` : `sm-${date}-${randomSuffix()}`;
}

export function emptyJob(jobId: string, topic: Topic): SelfMotivationJob {
  const now = nowIso();
  return {
    id: jobId,
    createdAt: now,
    updatedAt: now,
    topic,
    steps: {
      topic: { status: "done", updatedAt: now },
      research: {
        status: "pending",
        sources: [],
        queries: [],
        youtubeRefs: [],
      },
      script: { status: "pending" },
      scenes: { status: "pending" },
      images: { status: "pending" },
      tts: { status: "pending", voiceProvider: "gemini", voiceName: "Charon" },
      render: { status: "pending" },
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

export async function createJob(topic: Topic): Promise<SelfMotivationJob> {
  let id = generateJobId(topic.title);
  await mkdir(jobDir(id), { recursive: true });

  let suffix = 2;
  while (await fileExists(jobJsonPath(id))) {
    id = `${generateJobId(topic.title)}-${suffix}`;
    await mkdir(jobDir(id), { recursive: true });
    suffix += 1;
  }

  const job = emptyJob(id, topic);
  await saveJob(job);
  return job;
}

export async function loadJob(jobId: string): Promise<SelfMotivationJob> {
  const raw = await readFile(jobJsonPath(jobId), "utf-8");
  return SelfMotivationJobSchema.parse(JSON.parse(raw));
}

export async function saveJob(job: SelfMotivationJob): Promise<void> {
  const next: SelfMotivationJob = { ...job, updatedAt: nowIso() };
  await mkdir(jobDir(next.id), { recursive: true });
  await writeFile(
    jobJsonPath(next.id),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf-8",
  );
}

export async function listJobs(): Promise<SelfMotivationJob[]> {
  const root = jobsRootDir();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const jobs: SelfMotivationJob[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    try {
      const s = await stat(`${root}/${entry}`);
      if (!s.isDirectory()) continue;
      jobs.push(await loadJob(entry));
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
): Promise<SelfMotivationScript | null> {
  try {
    const raw = await readFile(scriptJsonPath(jobId), "utf-8");
    const parsed = SelfMotivationScriptSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeScriptJson(
  jobId: string,
  script: SelfMotivationScript,
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
): Promise<SelfMotivationScene[] | null> {
  try {
    const raw = await readFile(scenesJsonPath(jobId), "utf-8");
    const parsed = SelfMotivationScenesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.scenes : null;
  } catch {
    return null;
  }
}

export async function writeScenesJson(
  jobId: string,
  scenes: SelfMotivationScene[],
): Promise<void> {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(
    scenesJsonPath(jobId),
    `${JSON.stringify({ scenes }, null, 2)}\n`,
    "utf-8",
  );
}

export async function readYoutubeTranscript(
  jobId: string,
  videoId: string,
): Promise<string> {
  try {
    return await readFile(youtubeTranscriptMdPath(jobId, videoId), "utf-8");
  } catch {
    return "";
  }
}

export async function writeYoutubeTranscript(
  jobId: string,
  videoId: string,
  markdown: string,
): Promise<void> {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(
    youtubeTranscriptMdPath(jobId, videoId),
    markdown,
    "utf-8",
  );
}

export async function deleteYoutubeTranscript(
  jobId: string,
  videoId: string,
): Promise<void> {
  try {
    await rm(youtubeTranscriptMdPath(jobId, videoId));
  } catch {
    // ファイルが無いだけなら無視
  }
}

export async function readAllYoutubeTranscripts(
  jobId: string,
): Promise<Array<{ ref: SelfMotivationYoutubeRef; markdown: string }>> {
  const job = await loadJob(jobId);
  const refs = job.steps.research.youtubeRefs ?? [];
  const out: Array<{ ref: SelfMotivationYoutubeRef; markdown: string }> = [];
  for (const ref of refs) {
    if (ref.status !== "done") continue;
    const md = await readYoutubeTranscript(jobId, ref.videoId);
    if (md.trim()) out.push({ ref, markdown: md });
  }
  return out;
}

export async function updateStep<K extends SelfMotivationStepKey>(
  jobId: string,
  step: K,
  patch: Partial<SelfMotivationJob["steps"][K]>,
): Promise<SelfMotivationJob> {
  const job = await loadJob(jobId);
  const prev = job.steps[step] as SelfMotivationJob["steps"][K];
  const next: SelfMotivationJob = {
    ...job,
    steps: {
      ...job.steps,
      [step]: { ...prev, ...patch, updatedAt: nowIso() },
    },
  };
  await saveJob(next);
  return next;
}

export const STEP_ORDER = SELF_MOTIVATION_STEP_ORDER;
