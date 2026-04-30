import { NextRequest, NextResponse } from "next/server";
import { UkiyoeScenePlanSchema } from "@rekishi/shared";
import { loadJob, saveJob, writeScenePlanJson } from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = UkiyoeScenePlanSchema.safeParse(
    (body as { scenePlan?: unknown })?.scenePlan,
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join(", "),
      },
      { status: 400 },
    );
  }

  try {
    const job = await loadJob(jobId);
    await writeScenePlanJson(jobId, parsed.data);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        scenes: {
          ...job.steps.scenes,
          status: "done" as const,
          updatedAt: now,
          error: undefined,
        },
      },
    };
    await saveJob(next);
    return NextResponse.json({ ok: true, job: next, scenePlan: parsed.data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
