import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { RenderPlanSchema, type Script } from "@rekishi/shared";
import { setChannel } from "@rekishi/shared/channel";
import {
  runResearchStage,
  runDraftStage,
  runBuildStage,
  getJobOutputDir,
} from "./orchestrator.js";
import { jobPath } from "./storage/local.js";
import { dataPath, config } from "./config.js";
import {
  pickNextAvailable,
  markInProgress,
  markDone as markPoolDone,
  readPool,
  type PoolEntry,
} from "./auto-rekishi-pool.js";
import { poolEntryToTopic } from "./auto-rekishi-topic.js";
import {
  pickNextReady,
  listQueueFiles,
  readQueueFile,
  writeQueueFile,
  markQueueInProgress,
  markQueueDone,
  queueFilePath,
  type QueueFile,
} from "./auto-rekishi-queue.js";
import { scriptToQueueFile, queueFileToScript } from "./auto-rekishi-script-io.js";
import { generateSlug, isValidSlug, uniquifySlug } from "./slug-generator.js";
import {
  AutoStateSchema,
  readState,
  writeState,
  patchState,
  markStepDone,
  markFailed,
  DRAFT_STEPS,
  PUBLISH_STEPS,
  type AutoState,
  type AutoStep,
  type AutoPhase,
} from "./auto-rekishi-state.js";
import { confirmStep, summarizeStep } from "./auto-rekishi-review.js";

export type PublishPrivacy = "public" | "unlisted" | "private";

export interface RunOptions {
  mode: "unattended" | "review";
  dryRun: boolean;
  allowImageGeneration: boolean;
  /** publish 相のみ参照される。draft 相では無視。既定 public */
  privacy?: PublishPrivacy;
  fromStep?: AutoStep;
  toStep?: AutoStep;
}

const POOL_EXHAUSTED_EXIT = 3;
const QUEUE_EXHAUSTED_EXIT = 3;

/* ============================================================
 * Phase A: auto-draft（pool → research → draft → queue）
 * ============================================================ */

export async function runAutoDraft(opts: RunOptions): Promise<{ jobId: string; finalStep: AutoStep }> {
  setChannel("rekishi");

  const startStep = opts.fromStep ?? "pick-topic";
  if (!DRAFT_STEPS.includes(startStep)) {
    throw new Error(
      `auto-draft の fromStep は ${DRAFT_STEPS.join(" | ")} のいずれか。指定: ${startStep}`,
    );
  }

  const { state, entry } = await draftStepPickTopic(opts);
  return runDraftRemaining(state, entry, opts);
}

async function draftStepPickTopic(
  opts: RunOptions,
): Promise<{ state: AutoState; entry: PoolEntry }> {
  console.log(chalk.bold("\n[pick-topic] topic-ideas-pool.md から 1 件 pop"));
  const entry = await pickNextAvailable();
  if (!entry) {
    console.error(chalk.red("❌ 日本史セクションに利用可能なトピックがありません（pool 枯渇）"));
    process.exit(POOL_EXHAUSTED_EXIT);
  }

  const jobId = await reserveJobId();
  console.log(chalk.dim(`   jobId=${jobId}`));
  console.log(chalk.dim(`   title=${entry.title}`));
  console.log(chalk.dim(`   era=${entry.era}`));

  await markInProgress(entry, { jobId });

  const now = new Date().toISOString();
  const state = AutoStateSchema.parse({
    jobId,
    channel: "rekishi",
    mode: opts.mode,
    phase: "draft",
    topic: poolEntryToTopic(entry),
    pool: { lineNumber: entry.lineNumber, rawLine: entry.rawLine },
    queue: null,
    currentStep: "pick-topic",
    status: "running",
    startedAt: now,
    lastUpdatedAt: now,
    artifacts: {},
    options: {
      dryRun: opts.dryRun,
      allowImageGeneration: opts.allowImageGeneration,
    },
  });
  await writeState(state);

  return { state, entry };
}

async function runDraftRemaining(
  state: AutoState,
  entry: PoolEntry,
  opts: RunOptions,
): Promise<{ jobId: string; finalStep: AutoStep }> {
  const stepsToRun = computeStepsToRun(state, opts, "draft");
  let lastStep: AutoStep = state.currentStep;

  for (const step of stepsToRun) {
    try {
      console.log(chalk.bold(`\n[${step}] ${describeStep(step)}`));
      await patchState(state.jobId, { currentStep: step, status: "running" });
      const artifacts = await execDraftStep(step, state, entry);
      const updated = await markStepDone(state.jobId, step, artifacts);
      Object.assign(state, updated);
      lastStep = step;

      if (opts.mode === "review" && step !== "draft") {
        const summary = await summarizeStep(step, state);
        const decision = await confirmStep(step, summary);
        if (decision === "abort") {
          console.log(chalk.yellow(`\n⏸  jobId=${state.jobId} を ${step} 後に保留`));
          await patchState(state.jobId, { status: "awaiting-confirmation" });
          return { jobId: state.jobId, finalStep: step };
        }
      }
    } catch (err) {
      await markFailed(state.jobId, step, err);
      console.error(
        chalk.red(`\n❌ [${step}] failed: ${err instanceof Error ? err.message : String(err)}`),
      );
      if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
      process.exit(1);
    }
  }

  // draft フェーズ終了 → queue ファイルが書き出され awaiting-review に
  if (lastStep === "draft") {
    await patchState(state.jobId, { status: "awaiting-review" });
    console.log(chalk.cyan(`\n📝 jobId=${state.jobId} を awaiting-review に。queue ファイルを編集して status: ready に書き換えてください`));
  }
  return { jobId: state.jobId, finalStep: lastStep };
}

async function execDraftStep(
  step: AutoStep,
  state: AutoState,
  entry: PoolEntry,
): Promise<Partial<AutoState["artifacts"]>> {
  switch (step) {
    case "pick-topic":
      return {};
    case "research":
      return await execResearch(state);
    case "draft":
      return await execDraft(state, entry);
    default:
      throw new Error(`draft phase で予期しない step: ${step}`);
  }
}

async function execResearch(state: AutoState): Promise<Partial<AutoState["artifacts"]>> {
  const target = jobPath(state.jobId, "scripts", "research.md");
  if (await fileExists(target)) {
    console.log(chalk.dim("   既存 research.md を再利用"));
    return { research: target };
  }
  const result = await runResearchStage(state.topic, state.jobId);
  return { research: result.researchPath };
}

async function execDraft(
  state: AutoState,
  entry: PoolEntry,
): Promise<Partial<AutoState["artifacts"]>> {
  // 1. script.json を作る（既存 runDraftStage を流用）
  const scriptJson = jobPath(state.jobId, "scripts", "script.json");
  if (!(await fileExists(scriptJson))) {
    await runDraftStage(state.topic, state.jobId);
  } else {
    console.log(chalk.dim("   既存 script.json を再利用"));
  }
  const script = await loadScriptJson(scriptJson);

  // 2. research.md を読み込む（埋め込み用）
  const researchPath = state.artifacts.research ?? jobPath(state.jobId, "scripts", "research.md");
  const research = (await fs.readFile(researchPath, "utf-8").catch(() => "")) || "";

  // 3. slug を生成して衝突回避
  const taken = new Set<string>(
    (await listQueueFiles()).map((f) => f.meta.slug),
  );
  let slug: string;
  try {
    slug = await generateSlug(state.topic.title, state.topic.era);
    if (!isValidSlug(slug)) throw new Error(`invalid slug: ${slug}`);
    slug = uniquifySlug(slug, taken);
  } catch (err) {
    console.warn(chalk.yellow(`   ⚠ slug 生成失敗: ${err instanceof Error ? err.message : err} — jobId fallback`));
    slug = uniquifySlug(`topic-${state.jobId}`, taken);
  }

  // 4. queue ファイル書き出し
  const filePath = queueFilePath(slug);
  const queueFile = scriptToQueueFile(
    {
      script,
      research,
      slug,
      jobId: state.jobId,
      poolTitle: entry.title,
      poolLineNumber: entry.lineNumber,
      pattern: entry.pattern,
    },
    filePath,
  );
  await writeQueueFile(queueFile);

  // 5. state にも queue 情報を追記
  await patchState(state.jobId, {
    queue: { slug, path: filePath },
  });
  console.log(chalk.green(`   ✅ queue 出力: ${filePath}`));
  console.log(chalk.dim(`      narration ${script.narration.length}字 / research ${research.length}字`));

  return {
    draft: jobPath(state.jobId, "scripts", "draft.md"),
    queueFile: filePath,
  };
}

/* ============================================================
 * Phase B: auto-publish（queue → build → render → meta → post）
 * ============================================================ */

export async function runAutoPublish(opts: RunOptions): Promise<{ jobId: string; finalStep: AutoStep }> {
  setChannel("rekishi");

  const startStep = opts.fromStep ?? "pick-script";
  if (!PUBLISH_STEPS.includes(startStep)) {
    throw new Error(
      `auto-publish の fromStep は ${PUBLISH_STEPS.join(" | ")} のいずれか。指定: ${startStep}`,
    );
  }

  const { state, queue } = await publishStepPickScript(opts);
  return runPublishRemaining(state, queue, opts);
}

async function publishStepPickScript(
  opts: RunOptions,
): Promise<{ state: AutoState; queue: QueueFile }> {
  console.log(chalk.bold("\n[pick-script] queue から 1 件 pop"));
  const queue = await pickNextReady();
  if (!queue) {
    console.error(chalk.red("❌ queue に status: ready の台本がありません（queue 枯渇）"));
    process.exit(QUEUE_EXHAUSTED_EXIT);
  }

  // jobId は draft 段階で確保したものを再利用。手書き queue で空ならここで採番
  const jobId = queue.meta.jobId && queue.meta.jobId.match(/^[0-9a-f]{8}$/)
    ? queue.meta.jobId
    : await reserveJobId();
  console.log(chalk.dim(`   jobId=${jobId}`));
  console.log(chalk.dim(`   slug=${queue.meta.slug}`));
  console.log(chalk.dim(`   topic=${queue.meta.poolTitle ?? queue.meta.videoTitleBottom}`));

  await markQueueInProgress(queue.meta.slug, jobId);

  // queue → script.json を materialize（手動編集を反映）
  const script = queueFileToScript(queue);
  const scriptJsonPath = jobPath(jobId, "scripts", "script.json");
  await fs.mkdir(path.dirname(scriptJsonPath), { recursive: true });
  await fs.writeFile(scriptJsonPath, JSON.stringify(script, null, 2), "utf-8");

  // state は既存があれば phase を publish に更新、無ければ新規作成
  const existing = await readStateOrNull(jobId);
  const now = new Date().toISOString();
  const baseState: AutoState = existing
    ? {
        ...existing,
        phase: "publish",
        currentStep: "pick-script",
        status: "running",
        queue: { slug: queue.meta.slug, path: queue.filePath },
      }
    : AutoStateSchema.parse({
        jobId,
        channel: "rekishi",
        mode: opts.mode,
        phase: "publish",
        topic: {
          title: queue.meta.poolTitle ?? queue.meta.videoTitleBottom,
          era: queue.meta.era,
          subject: "日本史",
          target: "汎用",
          format: "single",
        },
        pool:
          queue.meta.poolLineNumber !== undefined && queue.meta.poolTitle
            ? {
                lineNumber: queue.meta.poolLineNumber,
                rawLine: "",
              }
            : null,
        queue: { slug: queue.meta.slug, path: queue.filePath },
        currentStep: "pick-script",
        status: "running",
        startedAt: now,
        lastUpdatedAt: now,
        artifacts: {},
        options: {
          dryRun: opts.dryRun,
          allowImageGeneration: opts.allowImageGeneration,
        },
      });
  await writeState(baseState);

  return { state: baseState, queue };
}

async function runPublishRemaining(
  state: AutoState,
  queue: QueueFile,
  opts: RunOptions,
): Promise<{ jobId: string; finalStep: AutoStep }> {
  const stepsToRun = computeStepsToRun(state, opts, "publish");
  let lastStep: AutoStep = state.currentStep;

  for (const step of stepsToRun) {
    try {
      console.log(chalk.bold(`\n[${step}] ${describeStep(step)}`));
      await patchState(state.jobId, { currentStep: step, status: "running" });
      const artifacts = await execPublishStep(step, state, queue, opts);
      const updated = await markStepDone(state.jobId, step, artifacts);
      Object.assign(state, updated);
      lastStep = step;

      if (opts.mode === "review" && step !== "post") {
        const summary = await summarizeStep(step, state);
        const decision = await confirmStep(step, summary);
        if (decision === "abort") {
          console.log(chalk.yellow(`\n⏸  jobId=${state.jobId} を ${step} 後に保留`));
          await patchState(state.jobId, { status: "awaiting-confirmation" });
          return { jobId: state.jobId, finalStep: step };
        }
      }
    } catch (err) {
      await markFailed(state.jobId, step, err);
      console.error(
        chalk.red(`\n❌ [${step}] failed: ${err instanceof Error ? err.message : String(err)}`),
      );
      if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
      process.exit(1);
    }
  }

  if (lastStep === "post" || opts.toStep === undefined) {
    if (lastStep === "post") {
      await markStepDone(state.jobId, "done");
      console.log(chalk.green(`\n✅ jobId=${state.jobId} 完了`));
    }
  }
  return { jobId: state.jobId, finalStep: lastStep };
}

async function execPublishStep(
  step: AutoStep,
  state: AutoState,
  queue: QueueFile,
  opts: RunOptions,
): Promise<Partial<AutoState["artifacts"]>> {
  switch (step) {
    case "pick-script":
      return {};
    case "build":
      return await execBuild(state);
    case "render":
      return await execRender(state);
    case "meta":
      return await execMeta(state);
    case "post":
      return await execPost(state, queue, opts);
    default:
      throw new Error(`publish phase で予期しない step: ${step}`);
  }
}

async function execBuild(state: AutoState): Promise<Partial<AutoState["artifacts"]>> {
  const renderPlan = jobPath(state.jobId, "scripts", "render-plan.json");
  if (await fileExists(renderPlan)) {
    console.log(chalk.dim("   既存 render-plan.json を再利用"));
    return collectBuildArtifacts(state.jobId);
  }
  await runBuildStage({
    jobId: state.jobId,
    allowImageGeneration: state.options.allowImageGeneration,
  });
  return collectBuildArtifacts(state.jobId);
}

function collectBuildArtifacts(jobId: string): Partial<AutoState["artifacts"]> {
  return {
    scenePlan: jobPath(jobId, "scripts", "scene-plan.json"),
    narrationWav: jobPath(jobId, "audio", "narration.wav"),
    wordsJson: jobPath(jobId, "captions", "words.json"),
    imagesJson: jobPath(jobId, "scripts", "images.json"),
    renderPlan: jobPath(jobId, "scripts", "render-plan.json"),
  };
}

async function execRender(state: AutoState): Promise<Partial<AutoState["artifacts"]>> {
  const renderPlanPath = state.artifacts.renderPlan ?? jobPath(state.jobId, "scripts", "render-plan.json");
  const planRaw = await fs.readFile(renderPlanPath, "utf-8");
  const plan = RenderPlanSchema.parse(JSON.parse(planRaw));
  const outputPath = path.join(getJobOutputDir(), buildOutputFilename(plan.script.topic.title, plan.id));

  if (await fileExists(outputPath)) {
    console.log(chalk.dim(`   既存 mp4 を再利用: ${outputPath}`));
    return { videoMp4: outputPath };
  }

  const { renderHistoryShort } = await import("@rekishi/renderer");
  console.log(chalk.dim("   Remotion でレンダリング中..."));
  await renderHistoryShort(plan, outputPath);
  console.log(chalk.green(`   ✅ ${outputPath}`));
  return { videoMp4: outputPath };
}

async function execMeta(state: AutoState): Promise<Partial<AutoState["artifacts"]>> {
  const metaJson = jobPath(state.jobId, "scripts", "meta.json");
  const metaDraft = jobPath(state.jobId, "scripts", "meta-draft.md");
  if (await fileExists(metaJson)) {
    console.log(chalk.dim("   既存 meta.json を再利用"));
    return { metaDraft };
  }
  await spawnPnpm([
    "--filter",
    "@rekishi/publisher",
    "exec",
    "tsx",
    "src/cli.ts",
    "meta",
    state.jobId,
    "--channel",
    "rekishi",
  ]);
  return { metaDraft };
}

async function execPost(
  state: AutoState,
  queue: QueueFile,
  opts: RunOptions,
): Promise<Partial<AutoState["artifacts"]>> {
  const uploadJsonPath = jobPath(state.jobId, "scripts", "upload.json");

  if (opts.dryRun) {
    console.log(chalk.yellow("   --dry-run のため YouTube 投稿を skip。queue は in-progress のまま"));
    return {};
  }

  if (!(await fileExists(uploadJsonPath))) {
    const privacy = opts.privacy ?? "public";
    await spawnPnpm([
      "--filter",
      "@rekishi/publisher",
      "exec",
      "tsx",
      "src/cli.ts",
      "youtube",
      state.jobId,
      "--channel",
      "rekishi",
      "--privacy",
      privacy,
    ]);
  } else {
    console.log(chalk.dim("   既存 upload.json を再利用（投稿スキップ）"));
  }

  const uploadRaw = await fs.readFile(uploadJsonPath, "utf-8");
  const upload = JSON.parse(uploadRaw) as { url?: string; videoId?: string; privacy?: string };
  if (!upload.url) throw new Error("upload.json に url がありません");

  // queue ファイルを done に
  await markQueueDone(queue.meta.slug, {
    jobId: state.jobId,
    url: upload.url,
    privacy: upload.privacy ?? "public",
  });
  console.log(chalk.green(`   ✅ queue 更新: status=done`));

  // pool ファイルも紐づきがあれば [✅] に
  if (queue.meta.poolTitle) {
    try {
      const entries = await readPool();
      const poolEntry =
        entries.find(
          (e) =>
            queue.meta.poolLineNumber !== undefined &&
            e.lineNumber === queue.meta.poolLineNumber,
        ) ?? entries.find((e) => e.title === queue.meta.poolTitle);
      if (poolEntry) {
        await markPoolDone(poolEntry, {
          jobId: state.jobId,
          url: upload.url,
          privacy: upload.privacy ?? "public",
          channel: "rekishi",
        });
        console.log(chalk.green(`   ✅ pool 更新: [✅] ${poolEntry.title}`));
      } else {
        console.log(chalk.dim(`   pool エントリ未検出（手書き queue か削除済み）— スキップ`));
      }
    } catch (err) {
      console.warn(chalk.yellow(`   ⚠ pool 更新失敗（投稿は成功）: ${err instanceof Error ? err.message : err}`));
    }
  }

  return { uploadJson: uploadJsonPath, youtubeUrl: upload.url };
}

/* ============================================================
 * Resume
 * ============================================================ */

export async function resumeAuto(
  jobId: string,
  opts: RunOptions,
): Promise<{ jobId: string; finalStep: AutoStep }> {
  setChannel("rekishi");

  const state = await readState(jobId);
  if (state.channel !== "rekishi") {
    throw new Error(`channel が rekishi ではありません: ${state.channel}`);
  }
  if (state.currentStep === "done") {
    console.log(chalk.green(`✅ jobId=${jobId} は既に done`));
    return { jobId, finalStep: "done" };
  }

  if (state.phase === "draft") {
    if (!state.pool) {
      throw new Error(`draft phase の resume に pool 情報がありません: ${jobId}`);
    }
    const entry = await locatePoolEntry(state);
    return runDraftRemaining(state, entry, opts);
  }

  // publish phase
  if (!state.queue) {
    throw new Error(`publish phase の resume に queue 情報がありません: ${jobId}`);
  }
  const queue = await readQueueFile(state.queue.path);
  return runPublishRemaining(state, queue, opts);
}

/* ============================================================
 * 共通ヘルパー
 * ============================================================ */

function computeStepsToRun(state: AutoState, opts: RunOptions, phase: AutoPhase): AutoStep[] {
  const order = phase === "draft" ? DRAFT_STEPS : PUBLISH_STEPS;

  let start: AutoStep;
  if (opts.fromStep) {
    start = opts.fromStep;
  } else if (state.status === "failed" && state.error) {
    start = state.error.step;
  } else if (state.status === "awaiting-confirmation") {
    const idx = order.indexOf(state.currentStep);
    start = idx >= 0 ? (order[Math.min(idx + 1, order.length - 1)] ?? state.currentStep) : state.currentStep;
  } else {
    start = state.currentStep;
  }

  const startIdx = order.indexOf(start);
  if (startIdx < 0) {
    throw new Error(
      `無効な開始ステップ (phase=${phase}): ${start}（status=${state.status}, currentStep=${state.currentStep}）`,
    );
  }

  const endStep = opts.toStep ?? order[order.length - 1]!;
  const endIdx = order.indexOf(endStep);
  if (endIdx < 0) throw new Error(`無効な toStep (phase=${phase}): ${endStep}`);

  return order
    .slice(startIdx, endIdx + 1)
    .filter((s) => {
      // pick 系ステップは新規実行 or fromStep 指定時のみ
      if (s === "pick-topic" || s === "pick-script") {
        return startIdx === 0;
      }
      return true;
    });
}

async function reserveJobId(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = randomUUID().slice(0, 8);
    const dir = dataPath("scripts", id);
    try {
      await fs.access(dir);
      continue;
    } catch {
      return id;
    }
  }
  throw new Error("jobId の確保に 5 回失敗しました");
}

async function readStateOrNull(jobId: string): Promise<AutoState | null> {
  try {
    return await readState(jobId);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function loadScriptJson(filePath: string): Promise<Script> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as Script;
}

async function locatePoolEntry(state: AutoState): Promise<PoolEntry> {
  if (!state.pool) {
    throw new Error("pool 情報がありません");
  }
  const entries = await readPool();
  const byLine = entries.find((e) => e.lineNumber === state.pool!.lineNumber);
  if (byLine && byLine.title === state.topic.title) return byLine;
  const byTitle = entries.find((e) => e.title === state.topic.title);
  if (byTitle) {
    console.log(chalk.yellow(`   ⚠ pool の lineNumber がずれています。タイトル一致で再特定: line=${byTitle.lineNumber}`));
    return byTitle;
  }
  console.log(chalk.yellow(`   ⚠ pool に該当エントリが見つかりません: ${state.topic.title}`));
  return {
    rawLine: state.pool.rawLine,
    status: "in-progress",
    region: "japan",
    era: state.topic.era ?? "",
    title: state.topic.title,
    description: "",
    needsFactCheck: false,
    lineNumber: state.pool.lineNumber,
  };
}

function buildOutputFilename(title: string, jobId: string): string {
  const safe = title.replace(/[\/\\:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  return safe ? `${safe}-${jobId}.mp4` : `${jobId}.mp4`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function spawnPnpm(args: string[]): Promise<void> {
  const res = spawnSync("pnpm", args, {
    stdio: "inherit",
    cwd: config.paths.repoRoot,
  });
  if (res.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} 失敗 (exit=${res.status})`);
  }
}

function describeStep(step: AutoStep): string {
  switch (step) {
    case "pick-topic":
      return "pool から 1 件選定";
    case "research":
      return "Gemini Pro + Google Search でリサーチ";
    case "draft":
      return "台本生成 → queue ファイルへ書き出し";
    case "pick-script":
      return "queue から 1 件選定 → script.json materialize";
    case "build":
      return "シーン分割 → TTS → ASR → 画像 → render-plan";
    case "render":
      return "Remotion でレンダリング";
    case "meta":
      return "YouTube メタドラフト生成";
    case "post":
      return "YouTube Shorts に投稿";
    case "done":
    case "failed":
      return "(終端)";
    default:
      return "";
  }
}
