import fs from "node:fs/promises";
import chalk from "chalk";
import { jobPath } from "./storage/local.js";
import type { AutoState, AutoStep } from "./auto-rekishi-state.js";

export interface ReviewSummary {
  artifactsToReview: string[];
  metrics: Record<string, string | number>;
  nextStep: AutoStep | null;
}

export async function summarizeStep(step: AutoStep, state: AutoState): Promise<ReviewSummary> {
  switch (step) {
    case "pick-topic":
      return {
        artifactsToReview: [],
        metrics: {
          jobId: state.jobId,
          title: state.topic.title,
          era: state.topic.era ?? "—",
        },
        nextStep: "research",
      };

    case "research": {
      const researchPath = state.artifacts.research ?? jobPath(state.jobId, "scripts", "research.md");
      const metrics = await readResearchMetrics(researchPath);
      return {
        artifactsToReview: [researchPath],
        metrics,
        nextStep: "draft",
      };
    }

    case "draft": {
      const draftPath = state.artifacts.draft ?? jobPath(state.jobId, "scripts", "draft.md");
      const scriptJsonPath = jobPath(state.jobId, "scripts", "script.json");
      const metrics = await readDraftMetrics(scriptJsonPath);
      return {
        artifactsToReview: [draftPath],
        metrics,
        nextStep: "build",
      };
    }

    case "build": {
      const renderPlan = state.artifacts.renderPlan ?? jobPath(state.jobId, "scripts", "render-plan.json");
      const metrics = await readBuildMetrics(renderPlan, jobPath(state.jobId, "scripts", "cost.json"));
      return {
        artifactsToReview: [
          state.artifacts.scenePlan ?? jobPath(state.jobId, "scripts", "scene-plan.json"),
          state.artifacts.imagesJson ?? jobPath(state.jobId, "scripts", "images.json"),
          renderPlan,
        ],
        metrics,
        nextStep: "render",
      };
    }

    case "render": {
      const mp4 = state.artifacts.videoMp4 ?? "";
      const metrics = await readVideoMetrics(mp4);
      return {
        artifactsToReview: mp4 ? [mp4] : [],
        metrics,
        nextStep: "meta",
      };
    }

    case "meta": {
      const metaJson = jobPath(state.jobId, "scripts", "meta.json");
      const metaDraft = state.artifacts.metaDraft ?? jobPath(state.jobId, "scripts", "meta-draft.md");
      const metrics = await readMetaMetrics(metaJson);
      return {
        artifactsToReview: [metaDraft],
        metrics,
        nextStep: "post",
      };
    }

    case "post":
    case "done":
    case "failed":
      return { artifactsToReview: [], metrics: {}, nextStep: null };
  }
}

export async function confirmStep(
  stepJustDone: AutoStep,
  summary: ReviewSummary,
): Promise<"continue" | "abort"> {
  console.log("");
  console.log(chalk.bold(`📋 [${stepJustDone}] 完了サマリ`));
  for (const [k, v] of Object.entries(summary.metrics)) {
    console.log(chalk.dim(`   ${k}: ${v}`));
  }
  if (summary.artifactsToReview.length > 0) {
    console.log(chalk.dim("   確認するファイル:"));
    for (const f of summary.artifactsToReview) {
      console.log(chalk.cyan(`     - ${f}`));
    }
  }

  const next = summary.nextStep ? `次は [${summary.nextStep}]` : "(これで完了)";
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(`\n${next} に進む？(y/N): `)).trim().toLowerCase();
    return ans === "y" || ans === "yes" ? "continue" : "abort";
  } finally {
    rl.close();
  }
}

async function readResearchMetrics(researchPath: string): Promise<Record<string, string | number>> {
  try {
    const md = await fs.readFile(researchPath, "utf-8");
    return { 文字数: md.length };
  } catch {
    return {};
  }
}

async function readDraftMetrics(scriptJsonPath: string): Promise<Record<string, string | number>> {
  try {
    const raw = await fs.readFile(scriptJsonPath, "utf-8");
    const data = JSON.parse(raw) as {
      narration?: string;
      estimatedDurationSec?: number;
      keyTerms?: unknown[];
    };
    return {
      narration文字数: data.narration?.length ?? 0,
      推定秒: data.estimatedDurationSec ?? 0,
      keyTerms: Array.isArray(data.keyTerms) ? data.keyTerms.length : 0,
    };
  } catch {
    return {};
  }
}

async function readBuildMetrics(
  renderPlanPath: string,
  costPath: string,
): Promise<Record<string, string | number>> {
  const out: Record<string, string | number> = {};
  try {
    const raw = await fs.readFile(renderPlanPath, "utf-8");
    const plan = JSON.parse(raw) as {
      scenes?: unknown[];
      totalDurationSec?: number;
      images?: { source?: string }[];
    };
    out.scenes = Array.isArray(plan.scenes) ? plan.scenes.length : 0;
    out.実測秒 = plan.totalDurationSec ? Number(plan.totalDurationSec.toFixed(2)) : 0;
    if (Array.isArray(plan.images)) {
      out.Wikimedia = plan.images.filter((i) => i.source === "wikimedia").length;
      out.生成 = plan.images.filter((i) => i.source === "generated").length;
      out.fallback = plan.images.filter((i) => i.source === "fallback").length;
    }
  } catch {
    // ignore
  }
  try {
    const raw = await fs.readFile(costPath, "utf-8");
    const cost = JSON.parse(raw) as { totalUsd?: number; totalJpy?: number };
    if (typeof cost.totalUsd === "number") out.cost_usd = Number(cost.totalUsd.toFixed(4));
    if (typeof cost.totalJpy === "number") out.cost_jpy = Math.round(cost.totalJpy);
  } catch {
    // ignore
  }
  return out;
}

async function readVideoMetrics(mp4Path: string): Promise<Record<string, string | number>> {
  if (!mp4Path) return {};
  try {
    const stat = await fs.stat(mp4Path);
    return { サイズ: `${(stat.size / 1024 / 1024).toFixed(2)} MB` };
  } catch {
    return {};
  }
}

async function readMetaMetrics(metaJsonPath: string): Promise<Record<string, string | number>> {
  try {
    const raw = await fs.readFile(metaJsonPath, "utf-8");
    const data = JSON.parse(raw) as {
      title?: string;
      description?: string;
      tags?: unknown[];
      privacyStatus?: string;
    };
    return {
      title長: data.title?.length ?? 0,
      description長: data.description?.length ?? 0,
      tags: Array.isArray(data.tags) ? data.tags.length : 0,
      privacy: data.privacyStatus ?? "—",
    };
  } catch {
    return {};
  }
}
