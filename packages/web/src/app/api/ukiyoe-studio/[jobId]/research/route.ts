import { NextRequest, NextResponse } from "next/server";
import { loadJob, saveJob, writeResearchMarkdown } from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PatchBody {
  markdown?: string;
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: PatchBody = {};
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.markdown !== "string") {
    return NextResponse.json(
      { ok: false, error: "markdown is required" },
      { status: 400 },
    );
  }

  try {
    const job = await loadJob(jobId);
    await writeResearchMarkdown(jobId, body.markdown);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        research: {
          ...job.steps.research,
          status: "done" as const,
          updatedAt: now,
          error: undefined,
        },
      },
    };
    await saveJob(next);
    return NextResponse.json({ ok: true, job: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
