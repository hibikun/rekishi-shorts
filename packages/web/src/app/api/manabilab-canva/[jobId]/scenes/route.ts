import { NextRequest, NextResponse } from "next/server";
import { ManabilabCanvaScenesSchema } from "@rekishi/shared";
import { loadJob, saveJob, writeScenesJson } from "@/lib/canva-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PatchBody {
  scenes?: unknown;
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

  const parsed = ManabilabCanvaScenesSchema.safeParse({ scenes: body.scenes });
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
      },
      { status: 400 },
    );
  }

  try {
    const job = await loadJob(jobId);
    await writeScenesJson(jobId, parsed.data.scenes);

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

    return NextResponse.json({ ok: true, job: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
