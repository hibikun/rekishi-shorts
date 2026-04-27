import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { RenderPlanSchema } from "@rekishi/shared";
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
  markDone,
  readPool,
  type PoolEntry,
} from "./auto-rekishi-pool.js";
import { poolEntryToTopic } from "./auto-rekishi-topic.js";
import {
  AutoStateSchema,
  readState,
  tryReadState,
  writeState,
  patchState,
  markStepDone,
  markFailed,
  type AutoState,
  type AutoStep,
} from "./auto-rekishi-state.js";
import { confirmStep, summarizeStep } from "./auto-rekishi-review.js";

export interface RunOptions {
  mode: "unattended" | "review";
  dryRun: boolean;
  allowImageGeneration: boolean;
  fromStep?: AutoStep;
  toStep?: AutoStep;
}

const STEP_ORDER: AutoStep[] = [
  "pick-topic",
  "research",
  "draft",
  "build",
  "render",
  "meta",
  "post",
];

const POOL_EXHAUSTED_EXIT = 3;

export async function runAutoOnce(opts: RunOptions): Promise<{ jobId: string; finalStep: AutoStep }> {
  setChannel("rekishi");

  const startStep = opts.fromStep ?? "pick-topic";
  if (startStep !== "pick-topic") {
    throw new Error(`auto run は pick-topic から開始します。途中ステップから始めるなら auto resume <jobId> を使ってください`);
  }

  const { state, entry } = await stepPickTopic(opts);
  return runRemaining(state, entry, opts);
}

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
    console.log(chalk.green(`✅ jobId=${jobId} は既に done です`));
    return { jobId, finalStep: "done" };
  }

  const entry = await locatePoolEntry(state);
  return runRemaining(state, entry, opts);
}

async function stepPickTopic(
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
    topic: poolEntryToTopic(entry),
    pool: { lineNumber: entry.lineNumber, rawLine: entry.rawLine },
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

async function runRemaining(
  state: AutoState,
  entry: PoolEntry,
  opts: RunOptions,
): Promise<{ jobId: string; finalStep: AutoStep }> {
  const stepsToRun = computeStepsToRun(state, opts);
  let lastStep: AutoStep = state.currentStep;

  for (const step of stepsToRun) {
    try {
      console.log(chalk.bold(`\n[${step}] ${describeStep(step)}`));
      await patchState(state.jobId, { currentStep: step, status: "running" });
      const artifacts = await execStep(step, state, entry, opts);
      const updated = await markStepDone(state.jobId, step, artifacts);
      Object.assign(state, updated);
      lastStep = step;

      if (opts.mode === "review" && step !== "post") {
        const summary = await summarizeStep(step, state);
        const decision = await confirmStep(step, summary);
        if (decision === "abort") {
          console.log(chalk.yellow(`\n⏸  jobId=${state.jobId} を ${step} 後に保留しました`));
          console.log(chalk.dim(`   再開: pnpm auto resume ${state.jobId}`));
          await patchState(state.jobId, { status: "awaiting-confirmation" });
          return { jobId: state.jobId, finalStep: step };
        }
      }
    } catch (err) {
      await markFailed(state.jobId, step, err);
      console.error(
        chalk.red(`\n❌ [${step}] failed: ${err instanceof Error ? err.message : String(err)}`),
      );
      if (err instanceof Error && err.stack) {
        console.error(chalk.dim(err.stack));
      }
      process.exit(1);
    }
  }

  // 全ステップ完走 or toStep に到達
  if (lastStep === "post" || opts.toStep === undefined) {
    if (lastStep === "post") {
      await markStepDone(state.jobId, "done");
      console.log(chalk.green(`\n✅ jobId=${state.jobId} 完了`));
    }
  }
  return { jobId: state.jobId, finalStep: lastStep };
}

function computeStepsToRun(state: AutoState, opts: RunOptions): AutoStep[] {
  const start = opts.fromStep ?? state.currentStep;
  const startIdx = STEP_ORDER.indexOf(start);
  if (startIdx < 0) {
    throw new Error(`無効な fromStep: ${start}`);
  }

  // resume 中 (failed) で、currentStep == "failed" の場合は state.error.step から再開
  let realStart = startIdx;
  if (state.status === "failed" && state.error) {
    const failedIdx = STEP_ORDER.indexOf(state.error.step);
    if (failedIdx >= 0) realStart = failedIdx;
  } else if (state.currentStep !== "pick-topic" && start === state.currentStep) {
    // running/awaiting-confirmation で再開する場合は、currentStep が完了済みなら次から
    if (state.status === "running") {
      // 同ステップから再実行（途中失敗の冪等性で skip 判定）
      realStart = startIdx;
    } else if (state.status === "awaiting-confirmation") {
      // review で abort した直後は次のステップから
      realStart = Math.min(startIdx + 1, STEP_ORDER.length - 1);
    }
  }

  const endStep = opts.toStep ?? "post";
  const endIdx = STEP_ORDER.indexOf(endStep);
  if (endIdx < 0) throw new Error(`無効な toStep: ${endStep}`);

  return STEP_ORDER.slice(realStart, endIdx + 1).filter((s) => s !== "pick-topic" || realStart === 0);
}

async function execStep(
  step: AutoStep,
  state: AutoState,
  entry: PoolEntry,
  opts: RunOptions,
): Promise<Partial<AutoState["artifacts"]>> {
  switch (step) {
    case "pick-topic":
      // 既に stepPickTopic で済んでいる
      return {};
    case "research":
      return await execResearch(state);
    case "draft":
      return await execDraft(state);
    case "build":
      return await execBuild(state);
    case "render":
      return await execRender(state);
    case "meta":
      return await execMeta(state);
    case "post":
      return await execPost(state, entry, opts);
    default:
      throw new Error(`unknown step: ${step}`);
  }
}

async function execResearch(state: AutoState): Promise<Partial<AutoState["artifacts"]>> {
  const target = jobPath(state.jobId, "scripts", "research.md");
  if (await fileExists(target)) {
    console.log(chalk.dim("   研究済み research.md を再利用"));
    return { research: target };
  }
  const result = await runResearchStage(state.topic, state.jobId);
  return { research: result.researchPath };
}

async function execDraft(state: AutoState): Promise<Partial<AutoState["artifacts"]>> {
  const scriptJson = jobPath(state.jobId, "scripts", "script.json");
  const draftMd = jobPath(state.jobId, "scripts", "draft.md");
  if (await fileExists(scriptJson)) {
    console.log(chalk.dim("   既存 script.json を再利用"));
    return { draft: draftMd };
  }
  const result = await runDraftStage(state.topic, state.jobId);
  return { draft: result.draftPath };
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
  entry: PoolEntry,
  opts: RunOptions,
): Promise<Partial<AutoState["artifacts"]>> {
  const uploadJsonPath = jobPath(state.jobId, "scripts", "upload.json");

  if (opts.dryRun) {
    console.log(chalk.yellow("   --dry-run のため YouTube 投稿を skip。pool は [~] のまま"));
    return {};
  }

  if (!(await fileExists(uploadJsonPath))) {
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
      "public",
    ]);
  } else {
    console.log(chalk.dim("   既存 upload.json を再利用（投稿スキップ）"));
  }

  const uploadRaw = await fs.readFile(uploadJsonPath, "utf-8");
  const upload = JSON.parse(uploadRaw) as { url?: string; videoId?: string; privacy?: string };
  if (!upload.url) {
    throw new Error("upload.json に url がありません");
  }

  // 投稿成功 → pool を [✅] に
  await markDone(entry, {
    jobId: state.jobId,
    url: upload.url,
    privacy: upload.privacy ?? "public",
    channel: "rekishi",
  });
  console.log(chalk.green(`   ✅ pool 更新: [✅] ${entry.title}`));

  return { uploadJson: uploadJsonPath, youtubeUrl: upload.url };
}

async function reserveJobId(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = randomUUID().slice(0, 8);
    const dir = dataPath("scripts", id);
    try {
      await fs.access(dir);
      // 衝突: 既に存在する → 別 ID を試す
      continue;
    } catch {
      return id;
    }
  }
  throw new Error("jobId の確保に 5 回失敗しました");
}

async function locatePoolEntry(state: AutoState): Promise<PoolEntry> {
  const entries = await readPool();

  // 完全一致で探す（マーカーが書き換わっている可能性があるので、行番号 → タイトル の順）
  const byLine = entries.find((e) => e.lineNumber === state.pool.lineNumber);
  if (byLine && byLine.title === state.topic.title) return byLine;

  const byTitle = entries.find((e) => e.title === state.topic.title);
  if (byTitle) {
    console.log(chalk.yellow(`   ⚠ pool の lineNumber がずれています。タイトル一致で再特定: line=${byTitle.lineNumber}`));
    return byTitle;
  }

  console.log(chalk.yellow(`   ⚠ pool に該当エントリが見つかりません: ${state.topic.title}`));
  // ダミーで返す（markDone 時に実害が出ないよう、書き戻しを諦めるためのプレースホルダ）
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
      return "台本生成 (script.json + draft.md)";
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
