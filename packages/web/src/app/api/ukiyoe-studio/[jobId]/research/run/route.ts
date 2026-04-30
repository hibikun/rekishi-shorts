import { NextRequest, NextResponse } from "next/server";
import { generateResearch } from "@rekishi/pipeline";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  loadJob,
  saveJob,
  writeResearchMarkdown,
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

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      research: {
        ...job.steps.research,
        status: "in-progress",
        updatedAt: startNow,
        error: undefined,
      },
    },
  });

  try {
    setChannel(UKIYOE_CHANNEL_SLUG);
    const result = await generateResearch(
      {
        title: job.topic.title,
        subject: "歴史",
        era: job.topic.era ?? undefined,
        target: "汎用",
      },
      { mode: job.topic.mode },
    );

    await writeResearchMarkdown(jobId, result.markdown);

    const doneNow = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        research: {
          status: "done" as const,
          updatedAt: doneNow,
          sources: result.sources,
          queries: result.queries,
          model: result.usage.model,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: true,
      job: next,
      markdown: result.markdown,
      sources: result.sources,
      queries: result.queries,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errNow = new Date().toISOString();
    const failed = await loadJob(jobId);
    await saveJob({
      ...failed,
      steps: {
        ...failed.steps,
        research: {
          ...failed.steps.research,
          status: "error",
          updatedAt: errNow,
          error: msg,
        },
      },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
