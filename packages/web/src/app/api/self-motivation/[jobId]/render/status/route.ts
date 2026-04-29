import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  renderStatusPath,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    const raw = await readFile(renderStatusPath(jobId), "utf-8");
    const status = JSON.parse(raw);
    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json({
      ok: true,
      status: { state: "idle", progress: 0 },
    });
  }
}
