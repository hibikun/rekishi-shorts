import { NextRequest, NextResponse } from "next/server";
import { transcribeUkiyoeYoutubeVideo } from "@rekishi/pipeline/ukiyoe-youtube-research";
import { setChannel } from "@rekishi/shared/channel";
import type { UkiyoeYoutubeRef } from "@rekishi/shared";
import {
  UKIYOE_CHANNEL_SLUG,
  deleteYoutubeTranscript,
  loadJob,
  saveJob,
  writeYoutubeTranscript,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ jobId: string; refId: string }>;
}

export async function DELETE(
  _request: NextRequest,
  ctx: Ctx,
): Promise<Response> {
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
    const next = {
      ...job,
      steps: {
        ...job.steps,
        research: {
          ...job.steps.research,
          youtubeRefs: refs.filter((r) => r.id !== refId),
        },
      },
    };
    await saveJob(next);
    await deleteYoutubeTranscript(jobId, target.videoId);
    return NextResponse.json({ ok: true, job: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
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

    const now = new Date().toISOString();
    const runningRef: UkiyoeYoutubeRef = {
      ...target,
      status: "running",
      error: undefined,
      updatedAt: now,
    };
    let next = {
      ...job,
      steps: {
        ...job.steps,
        research: {
          ...job.steps.research,
          youtubeRefs: refs.map((r) => (r.id === refId ? runningRef : r)),
        },
      },
    };
    await saveJob(next);

    try {
      const result = await transcribeUkiyoeYoutubeVideo({
        topic: job.topic,
        videoId: target.videoId,
        note: target.note,
      });
      await writeYoutubeTranscript(jobId, target.videoId, result.markdown);
      const doneAt = new Date().toISOString();
      const doneRef: UkiyoeYoutubeRef = {
        ...runningRef,
        status: "done",
        transcriptPath: `scripts/${jobId}/youtube-${target.videoId}.md`,
        generatedAt: doneAt,
        updatedAt: doneAt,
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        error: undefined,
      };
      const refresh = await loadJob(jobId);
      next = {
        ...refresh,
        steps: {
          ...refresh.steps,
          research: {
            ...refresh.steps.research,
            youtubeRefs: (refresh.steps.research.youtubeRefs ?? []).map((r) =>
              r.id === refId ? doneRef : r,
            ),
          },
        },
      };
      await saveJob(next);
      return NextResponse.json({ ok: true, ref: doneRef, job: next });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failedAt = new Date().toISOString();
      const failedRef: UkiyoeYoutubeRef = {
        ...runningRef,
        status: "error",
        error: msg,
        updatedAt: failedAt,
      };
      const refresh = await loadJob(jobId);
      next = {
        ...refresh,
        steps: {
          ...refresh.steps,
          research: {
            ...refresh.steps.research,
            youtubeRefs: (refresh.steps.research.youtubeRefs ?? []).map((r) =>
              r.id === refId ? failedRef : r,
            ),
          },
        },
      };
      await saveJob(next);
      return NextResponse.json(
        { ok: false, ref: failedRef, job: next, error: msg },
        { status: 500 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
