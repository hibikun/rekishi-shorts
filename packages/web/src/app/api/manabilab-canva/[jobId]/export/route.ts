import { NextRequest, NextResponse } from "next/server";
import { createCanvaExport } from "@/lib/canva-export";
import {
  loadJob,
  readScenesJson,
  readScriptJson,
  saveJob,
} from "@/lib/canva-job";
import type { ManabilabCanvaJob } from "@rekishi/shared";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

function exportUrls(job: ManabilabCanvaJob): {
  zipUrl?: string;
  manifestUrl?: string;
} {
  const step = job.steps.export;
  return {
    zipUrl: step.zipPath ? `/manabilab-canva/${step.zipPath}` : undefined,
    manifestUrl: step.manifestPath
      ? `/manabilab-canva/${step.manifestPath}`
      : undefined,
  };
}

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  try {
    const job = await loadJob(jobId);
    return NextResponse.json({
      ok: true,
      export: job.steps.export,
      ...exportUrls(job),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
  }
}

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let job: ManabilabCanvaJob;
  try {
    job = await loadJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
  }

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      export: {
        ...job.steps.export,
        status: "in-progress",
        updatedAt: startNow,
        error: undefined,
      },
    },
  });

  try {
    const [script, scenes] = await Promise.all([
      readScriptJson(jobId),
      readScenesJson(jobId),
    ]);
    const result = await createCanvaExport({ job, script, scenes });
    const now = new Date().toISOString();
    const nextJob: ManabilabCanvaJob = {
      ...job,
      steps: {
        ...job.steps,
        export: {
          ...job.steps.export,
          status: "done",
          updatedAt: now,
          error: undefined,
          generatedAt: result.manifest.generatedAt,
          manifestPath: result.manifestPath,
          zipPath: result.zipPath,
          assetCounts: result.manifest.assetCounts,
        },
      },
    };
    await saveJob(nextJob);

    return NextResponse.json({
      ok: true,
      job: nextJob,
      manifest: result.manifest,
      ...exportUrls(nextJob),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const now = new Date().toISOString();
    const nextJob: ManabilabCanvaJob = {
      ...job,
      steps: {
        ...job.steps,
        export: {
          ...job.steps.export,
          status: "error",
          updatedAt: now,
          error: msg,
        },
      },
    };
    await saveJob(nextJob);
    return NextResponse.json(
      { ok: false, error: msg, job: nextJob },
      { status: 400 },
    );
  }
}
