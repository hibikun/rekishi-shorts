import { NextRequest, NextResponse } from "next/server";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  expandScriptToScenes,
  loadJob,
  readScriptJson,
  saveJob,
  writeScenesJson,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    const script = await readScriptJson(jobId);
    if (!script) {
      return NextResponse.json(
        { ok: false, error: "script.json が読めません。先に script を実行" },
        { status: 400 },
      );
    }
    const scenes = expandScriptToScenes(script);
    await writeScenesJson(jobId, scenes);
    const job = await loadJob(jobId);
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
    return NextResponse.json({ ok: true, job: next, scenes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
