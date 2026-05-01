import { NextRequest, NextResponse } from "next/server";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  loadJob,
  readYoutubeTranscript,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string; refId: string }>;
}

/** 1 件分の書き起こし markdown を返す。 */
export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, refId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
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
    const md = await readYoutubeTranscript(jobId, target.videoId);
    return NextResponse.json({ ok: true, markdown: md, ref: target });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
