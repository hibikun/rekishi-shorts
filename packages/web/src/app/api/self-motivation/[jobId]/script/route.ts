import { NextRequest, NextResponse } from "next/server";
import { SelfMotivationScriptSchema } from "@rekishi/shared";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  loadJob,
  saveJob,
  writeScriptJson,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";

setChannel(SELF_MOTIVATION_CHANNEL);

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
  const parsed = SelfMotivationScriptSchema.safeParse(body);
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
    await writeScriptJson(jobId, parsed.data);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        script: {
          ...job.steps.script,
          status: "done" as const,
          updatedAt: now,
          estimatedDurationSec: parsed.data.estimatedDurationSec,
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
