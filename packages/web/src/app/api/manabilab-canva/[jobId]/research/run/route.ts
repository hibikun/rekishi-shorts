import { NextRequest, NextResponse } from "next/server";
import { generateResearch } from "@rekishi/pipeline";
import { setChannel } from "@rekishi/shared/channel";
import {
  CANVA_CHANNEL_SLUG,
  loadJob,
  saveJob,
  writeResearchMarkdown,
} from "@/lib/canva-job";

export const runtime = "nodejs";
// Gemini + Google Search は数十秒かかる可能性があるので緩める
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
    return NextResponse.json({ ok: false, error: `job not found: ${msg}` }, { status: 404 });
  }

  // in-progress に更新
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
    setChannel(CANVA_CHANNEL_SLUG);
    const result = await generateResearch(job.topic);

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
