import { NextRequest, NextResponse } from "next/server";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  deleteYoutubeTranscript,
  loadJob,
  saveJob,
  transcribeYoutubeVideo,
  writeYoutubeTranscript,
} from "@rekishi/pipeline/self-motivation";
import type { SelfMotivationYoutubeRef } from "@rekishi/shared";

export const runtime = "nodejs";
export const maxDuration = 300;

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string; refId: string }>;
}

/** ref を 1 件削除し、付随する書き起こし md も消す。 */
export async function DELETE(
  _request: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const { jobId: rawJobId, refId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  setChannel(SELF_MOTIVATION_CHANNEL);
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

/**
 * 既存 ref の書き起こしを再生成する (POST /retry)。
 * エラー状態 ref のリトライや、より良いプロンプトを試したいときに使う。
 */
export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, refId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  setChannel(SELF_MOTIVATION_CHANNEL);
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
    const runningRef: SelfMotivationYoutubeRef = {
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
      const result = await transcribeYoutubeVideo({
        topic: job.topic,
        videoId: target.videoId,
        note: target.note,
      });
      await writeYoutubeTranscript(jobId, target.videoId, result.markdown);
      const doneAt = new Date().toISOString();
      const doneRef: SelfMotivationYoutubeRef = {
        ...runningRef,
        status: "done",
        transcriptPath: `jobs/${jobId}/youtube-${target.videoId}.md`,
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
      const failedRef: SelfMotivationYoutubeRef = {
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
