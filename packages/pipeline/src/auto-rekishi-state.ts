import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { channelDataPath } from "@rekishi/shared/channel";

export const AutoStepSchema = z.enum([
  "pick-topic",
  "research",
  "draft",
  "pick-script",
  "build",
  "render",
  "meta",
  "post",
  "done",
  "failed",
]);
export type AutoStep = z.infer<typeof AutoStepSchema>;

export const AutoStatusSchema = z.enum([
  "running",
  "awaiting-confirmation",
  "awaiting-review",
  "done",
  "failed",
]);
export type AutoStatus = z.infer<typeof AutoStatusSchema>;

export const AutoPhaseSchema = z.enum(["draft", "publish"]);
export type AutoPhase = z.infer<typeof AutoPhaseSchema>;

/** draft 相のステップ列。pick-topic → research → draft で完了し awaiting-review に入る */
export const DRAFT_STEPS: AutoStep[] = ["pick-topic", "research", "draft"];
/** publish 相のステップ列。queue から script.json を作って build 以降を回す */
export const PUBLISH_STEPS: AutoStep[] = [
  "pick-script",
  "build",
  "render",
  "meta",
  "post",
];

export const AutoStateSchema = z.object({
  jobId: z.string().regex(/^[0-9a-f]{8}$/),
  channel: z.literal("rekishi"),
  mode: z.enum(["unattended", "review"]),
  /**
   * 自動投稿を 2 相に分けて運用する:
   *   - "draft":   pool pop → research → draft → queue 出力（人間レビュー待ち）
   *   - "publish": queue pop → build → render → meta → post
   * draft 完走時に awaiting-review で停止し、publish 開始時に phase を切り替える。
   */
  phase: AutoPhaseSchema.default("draft"),
  topic: z.object({
    title: z.string().min(1),
    era: z.string().optional(),
    subject: z.string().min(1).default("日本史"),
    target: z.enum(["共通テスト", "二次", "汎用"]).default("汎用"),
    format: z.enum(["single", "three-pick"]).default("single"),
  }),
  /** pool から pop した行情報。手書き queue から開始した場合は null。 */
  pool: z
    .object({
      lineNumber: z.number().int().nonnegative(),
      rawLine: z.string(),
    })
    .nullable()
    .default(null),
  /** queue ファイル情報。draft 完了後に埋まる。 */
  queue: z
    .object({
      slug: z.string().min(1),
      path: z.string().min(1),
    })
    .nullable()
    .default(null),
  currentStep: AutoStepSchema,
  status: AutoStatusSchema,
  error: z
    .object({
      step: AutoStepSchema,
      message: z.string(),
      stack: z.string().optional(),
      at: z.string(),
    })
    .optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  lastUpdatedAt: z.string(),
  artifacts: z
    .object({
      research: z.string().optional(),
      draft: z.string().optional(),
      queueFile: z.string().optional(),
      scenePlan: z.string().optional(),
      narrationWav: z.string().optional(),
      wordsJson: z.string().optional(),
      imagesJson: z.string().optional(),
      renderPlan: z.string().optional(),
      videoMp4: z.string().optional(),
      metaDraft: z.string().optional(),
      uploadJson: z.string().optional(),
      youtubeUrl: z.string().url().optional(),
    })
    .default({}),
  options: z.object({
    dryRun: z.boolean(),
    allowImageGeneration: z.boolean(),
  }),
});
export type AutoState = z.infer<typeof AutoStateSchema>;

export function statePath(jobId: string): string {
  return channelDataPath("scripts", jobId, "auto-state.json");
}

export async function readState(jobId: string): Promise<AutoState> {
  const raw = await fs.readFile(statePath(jobId), "utf-8");
  return AutoStateSchema.parse(JSON.parse(raw));
}

export async function tryReadState(jobId: string): Promise<AutoState | null> {
  try {
    return await readState(jobId);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeState(state: AutoState): Promise<void> {
  const validated = AutoStateSchema.parse({
    ...state,
    lastUpdatedAt: new Date().toISOString(),
  });
  const file = statePath(validated.jobId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // temp → rename で原子的に書く
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(validated, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

export async function patchState(
  jobId: string,
  patch: Partial<AutoState>,
): Promise<AutoState> {
  const current = await readState(jobId);
  const next: AutoState = {
    ...current,
    ...patch,
    artifacts: { ...current.artifacts, ...(patch.artifacts ?? {}) },
    options: { ...current.options, ...(patch.options ?? {}) },
  };
  await writeState(next);
  return next;
}

export async function markStepDone(
  jobId: string,
  step: AutoStep,
  artifacts: Partial<AutoState["artifacts"]> = {},
): Promise<AutoState> {
  const patch: Partial<AutoState> = {
    currentStep: step,
    status: step === "done" ? "done" : "running",
    artifacts: { ...artifacts },
  };
  if (step === "done") {
    patch.finishedAt = new Date().toISOString();
  }
  return patchState(jobId, patch);
}

export async function markFailed(
  jobId: string,
  step: AutoStep,
  err: unknown,
): Promise<AutoState> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  return patchState(jobId, {
    currentStep: "failed",
    status: "failed",
    error: { step, message, stack, at: new Date().toISOString() },
    finishedAt: new Date().toISOString(),
  });
}

export interface ListStatesOptions {
  includeFailed?: boolean;
  includeDone?: boolean;
  includeAwaitingReview?: boolean;
  phase?: AutoPhase;
}

/** data/rekishi/scripts/<jobId>/auto-state.json を全部読む。 */
export async function listStates(opts: ListStatesOptions = {}): Promise<AutoState[]> {
  const baseDir = channelDataPath("scripts");
  let dirs: string[];
  try {
    dirs = await fs.readdir(baseDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const states: AutoState[] = [];
  for (const dir of dirs) {
    const stateFile = path.join(baseDir, dir, "auto-state.json");
    try {
      const raw = await fs.readFile(stateFile, "utf-8");
      const state = AutoStateSchema.parse(JSON.parse(raw));
      if (state.status === "done" && !opts.includeDone) continue;
      if (state.status === "failed" && !opts.includeFailed) continue;
      if (state.status === "awaiting-review" && opts.includeAwaitingReview === false) continue;
      if (opts.phase && state.phase !== opts.phase) continue;
      states.push(state);
    } catch {
      // 壊れたファイルや未知のスキーマはスキップ
    }
  }
  states.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return states;
}
