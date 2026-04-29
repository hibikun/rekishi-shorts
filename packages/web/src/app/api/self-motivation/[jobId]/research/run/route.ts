import { NextRequest, NextResponse } from "next/server";
import { setChannel } from "@rekishi/shared/channel";
import { generateResearch } from "@rekishi/pipeline";
import {
  SELF_MOTIVATION_CHANNEL,
  loadJob,
  saveJob,
  writeResearchMarkdown,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";
export const maxDuration = 300;

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    setChannel(SELF_MOTIVATION_CHANNEL);
    const job = await loadJob(jobId);
    const r = await generateResearch(job.topic);
    await writeResearchMarkdown(jobId, r.markdown);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        research: {
          ...job.steps.research,
          status: "done" as const,
          updatedAt: now,
          sources: r.sources,
          queries: r.queries,
          model: r.usage.model,
          error: undefined,
        },
      },
    };
    await saveJob(next);
    return NextResponse.json({ ok: true, job: next, markdown: r.markdown });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
