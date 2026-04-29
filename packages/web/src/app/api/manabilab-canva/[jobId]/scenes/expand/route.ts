import { NextRequest, NextResponse } from "next/server";
import { expandScriptToScenes } from "@rekishi/pipeline";
import {
  loadJob,
  readScriptJson,
  saveJob,
  writeScenesJson,
} from "@/lib/canva-job";

export const runtime = "nodejs";

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

  if (job.steps.script.status !== "done") {
    return NextResponse.json(
      { ok: false, error: "script ステップを先に完了してください" },
      { status: 400 },
    );
  }

  const script = await readScriptJson(jobId);
  if (!script) {
    return NextResponse.json(
      { ok: false, error: "script.json が読めません。台本を再生成してください" },
      { status: 400 },
    );
  }

  try {
    const scenes = expandScriptToScenes(script);
    await writeScenesJson(jobId, scenes);

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
