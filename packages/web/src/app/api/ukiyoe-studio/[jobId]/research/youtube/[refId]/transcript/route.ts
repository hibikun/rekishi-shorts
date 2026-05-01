import { NextRequest, NextResponse } from "next/server";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  loadJob,
  readYoutubeTranscript,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string; refId: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, refId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  setChannel(UKIYOE_CHANNEL_SLUG);
  try {
    const job = await loadJob(jobId);
    const refs = job.steps.research.youtubeRefs ?? [];
    const target = refs.find((r) => r.id === refId);
    if (!target) {
      return NextResponse.json(
        { ok: false, error: "ref not found" },
        { status: 404 },
      );
    }
    const markdown = await readYoutubeTranscript(jobId, target.videoId);
    return NextResponse.json({ ok: true, markdown, ref: target });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
