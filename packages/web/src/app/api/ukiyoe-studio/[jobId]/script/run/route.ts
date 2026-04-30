import { NextRequest, NextResponse } from "next/server";
import { generateUkiyoeScript } from "@rekishi/pipeline/ukiyoe-script-generator";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  loadJob,
  readResearchMarkdown,
  saveJob,
  writeScriptJson,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

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

  if (job.steps.research.status !== "done") {
    return NextResponse.json(
      { ok: false, error: "research ステップを先に完了してください" },
      { status: 400 },
    );
  }

  const researchMd = await readResearchMarkdown(jobId);
  if (!researchMd.trim()) {
    return NextResponse.json(
      { ok: false, error: "research.md が空です" },
      { status: 400 },
    );
  }

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      script: {
        ...job.steps.script,
        status: "in-progress",
        updatedAt: startNow,
        error: undefined,
      },
    },
  });

  try {
    setChannel(UKIYOE_CHANNEL_SLUG);
    const result = await generateUkiyoeScript({
      topic: job.topic.title,
      era: job.topic.era ?? undefined,
      researchMd,
      mode: job.topic.mode,
      targetSceneCount: job.topic.sceneCount,
      targetDurationSec: job.topic.sceneCount * 5,
    });

    const script = {
      ...result.script,
      era: result.script.era ?? null,
    };

    await writeScriptJson(jobId, script);

    const doneNow = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        script: {
          status: "done" as const,
          updatedAt: doneNow,
          model: result.usage.model,
          estimatedDurationSec: result.script.estimatedDurationSec,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({ ok: true, job: next, script });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errNow = new Date().toISOString();
    const failed = await loadJob(jobId);
    await saveJob({
      ...failed,
      steps: {
        ...failed.steps,
        script: {
          ...failed.steps.script,
          status: "error",
          updatedAt: errNow,
          error: msg,
        },
      },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
