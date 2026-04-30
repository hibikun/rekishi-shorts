import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  generateUkiyoeVideos,
  type UkiyoeSceneVideoInput,
} from "@rekishi/pipeline/ukiyoe-video-generator";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  imagesDir,
  loadJob,
  readScenePlanJson,
  saveJob,
  videosDir,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 800;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PostBody {
  /** dry-run なら fal.ai 呼ばずに prompt/params を返すだけ。default true (安全側) */
  dryRun?: boolean;
  /** 生成解像度。default 720p */
  resolution?: "480p" | "720p";
  /** 既存 mp4 を上書きするか。default false */
  force?: boolean;
  /** 一部シーンのみ */
  sceneIndices?: number[];
}

function sceneToken(i: number): string {
  return i.toString().padStart(2, "0");
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // body 無し → 既定値
  }

  const dryRun = body.dryRun !== false;
  const resolution = body.resolution ?? "720p";

  let job;
  try {
    job = await loadJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
  }

  const plan = await readScenePlanJson(jobId);
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: "scene-plan.json が見つかりません" },
      { status: 400 },
    );
  }

  const target =
    body.sceneIndices && body.sceneIndices.length > 0
      ? new Set(body.sceneIndices)
      : null;

  const sceneInputs: UkiyoeSceneVideoInput[] = plan.scenes
    .filter((s) => (target ? target.has(s.index) : true))
    .map((s) => ({
      index: s.index,
      imagePath: path.join(imagesDir(jobId), `scene-${sceneToken(s.index)}.png`),
      scenePrompt: s.videoPrompt,
      actionTag: s.actionTag,
      cameraFixed: s.cameraFixed,
      duration: 5,
    }));

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      videos: {
        ...job.steps.videos,
        status: "in-progress",
        updatedAt: startNow,
        lastDryRun: dryRun,
        error: undefined,
      },
    },
  });

  const logs: string[] = [];
  try {
    setChannel(UKIYOE_CHANNEL_SLUG);
    const startedAt = Date.now();
    const results = await generateUkiyoeVideos(sceneInputs, videosDir(jobId), {
      dryRun,
      resolution,
      skipExisting: !body.force,
      onProgress: (m) => {
        logs.push(m);
        console.log(`[ukiyoe-studio:${jobId}] ${m}`);
      },
    });
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const totalCost = results.reduce((s, r) => s + r.estimatedCostUsd, 0);

    const newDone = results
      .filter((r) => r.status === "done")
      .map((r) => r.index);
    const merged = Array.from(
      new Set([...(job.steps.videos.generatedScenes ?? []), ...newDone]),
    ).sort((a, b) => a - b);
    const allDone =
      !dryRun && plan.scenes.every((s) => merged.includes(s.index));

    const next = {
      ...job,
      steps: {
        ...job.steps,
        videos: {
          ...job.steps.videos,
          status: (allDone ? "done" : "in-progress") as
            | "done"
            | "in-progress",
          updatedAt: new Date().toISOString(),
          resolution,
          generatedScenes: merged,
          totalEstimatedCostUsd: totalCost,
          lastDryRun: dryRun,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: true,
      job: next,
      dryRun,
      resolution,
      elapsedSec,
      totalEstimatedCostUsd: totalCost,
      results: results.map((r) => ({
        index: r.index,
        status: r.status,
        prompt: r.prompt,
        duration: r.duration,
        videoPath: r.videoPath,
        estimatedCostUsd: r.estimatedCostUsd,
        error: r.error,
      })),
      logs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed = await loadJob(jobId);
    await saveJob({
      ...failed,
      steps: {
        ...failed.steps,
        videos: {
          ...failed.steps.videos,
          status: "error",
          updatedAt: new Date().toISOString(),
          error: msg,
        },
      },
    });
    return NextResponse.json({ ok: false, error: msg, logs }, { status: 500 });
  }
}
