import { NextRequest, NextResponse } from "next/server";
import { generateUkiyoeImages } from "@rekishi/pipeline/ukiyoe-image-generator";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  imagesDir,
  loadJob,
  readScenePlanJson,
  saveJob,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 600;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PostBody {
  /** 指定がなければ全シーン */
  sceneIndices?: number[];
  /** 既存画像も上書きするか。default false */
  force?: boolean;
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // body 無し → 全件
  }

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
      { ok: false, error: "scene-plan.json が見つかりません。Scenes ステップを完了してください" },
      { status: 400 },
    );
  }

  const targetIndices =
    body.sceneIndices && body.sceneIndices.length > 0
      ? new Set(body.sceneIndices)
      : null;
  const inputs = plan.scenes
    .filter((s) => (targetIndices ? targetIndices.has(s.index) : true))
    .map((s) => ({ index: s.index, scenePrompt: s.imagePrompt }));

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      images: {
        ...job.steps.images,
        status: "in-progress",
        updatedAt: startNow,
        error: undefined,
      },
    },
  });

  const logs: string[] = [];
  try {
    setChannel(UKIYOE_CHANNEL_SLUG);
    const results = await generateUkiyoeImages(inputs, imagesDir(jobId), {
      skipExisting: !body.force,
      concurrency: 3,
      onProgress: (m) => {
        logs.push(m);
        console.log(`[ukiyoe-studio:${jobId}] ${m}`);
      },
    });

    const newDone = results.filter((r) => !r.skipped).map((r) => r.index);
    const merged = Array.from(
      new Set([...(job.steps.images.generatedScenes ?? []), ...newDone]),
    ).sort((a, b) => a - b);
    const allDone = plan.scenes.every((s) => merged.includes(s.index));

    const doneNow = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        images: {
          ...job.steps.images,
          status: (allDone ? "done" : "in-progress") as
            | "done"
            | "in-progress",
          updatedAt: doneNow,
          generatedScenes: merged,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: true,
      job: next,
      results: results.map((r) => ({
        index: r.index,
        imagePath: r.imagePath,
        skipped: r.skipped,
        retried: r.retried,
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
        images: {
          ...failed.steps.images,
          status: "error",
          updatedAt: new Date().toISOString(),
          error: msg,
        },
      },
    });
    return NextResponse.json({ ok: false, error: msg, logs }, { status: 500 });
  }
}
