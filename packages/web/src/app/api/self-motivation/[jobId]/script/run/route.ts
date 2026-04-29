import { NextRequest, NextResponse } from "next/server";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  generateSelfMotivationScript,
  loadJob,
  readResearchMarkdown,
  saveJob,
  writeScriptJson,
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
    const md = await readResearchMarkdown(jobId);
    const r = await generateSelfMotivationScript(job.topic, md);
    await writeScriptJson(jobId, r.script);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        script: {
          ...job.steps.script,
          status: "done" as const,
          updatedAt: now,
          model: r.usage.model,
          estimatedDurationSec: r.script.estimatedDurationSec,
          error: undefined,
        },
      },
    };
    await saveJob(next);
    return NextResponse.json({ ok: true, job: next, script: r.script });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
