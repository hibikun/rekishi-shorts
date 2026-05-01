import { NextRequest, NextResponse } from "next/server";
import {
  loadJob,
  readResearchMarkdown,
  readScenePlanJson,
  readScriptJson,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    const job = await loadJob(jobId);
    const [researchMd, script, scenePlan] = await Promise.all([
      readResearchMarkdown(jobId),
      readScriptJson(jobId),
      readScenePlanJson(jobId),
    ]);
    return NextResponse.json({
      ok: true,
      job,
      researchMd,
      script,
      scenePlan,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
  }
}
