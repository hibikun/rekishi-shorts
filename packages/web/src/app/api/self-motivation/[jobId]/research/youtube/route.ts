import { NextRequest, NextResponse } from "next/server";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  extractYoutubeVideoId,
  generateRefId,
  loadJob,
  normalizeYoutubeWatchUrl,
  saveJob,
  transcribeYoutubeVideo,
  writeYoutubeTranscript,
} from "@rekishi/pipeline/self-motivation";
import type { SelfMotivationYoutubeRef } from "@rekishi/shared";

export const runtime = "nodejs";
export const maxDuration = 300;

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    const job = await loadJob(jobId);
    return NextResponse.json({
      ok: true,
      refs: job.steps.research.youtubeRefs ?? [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * 参考動画を 1 本追加して、即座に Gemini で書き起こしを生成する。
 * 失敗した ref は status="error" + error メッセージで残す（ユーザが retry できる）。
 */
export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  let body: { url?: string; note?: string; title?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "url is required" },
      { status: 400 },
    );
  }
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "YouTube URL から videoId を抽出できなかった (例: https://www.youtube.com/watch?v=XXXXXXXXXXX)",
      },
      { status: 400 },
    );
  }

  setChannel(SELF_MOTIVATION_CHANNEL);
  try {
    const job = await loadJob(jobId);
    const existingRefs = job.steps.research.youtubeRefs ?? [];
    if (existingRefs.some((r) => r.videoId === videoId)) {
      return NextResponse.json(
        {
          ok: false,
          error: `既に追加済みの動画です (videoId: ${videoId})。不要なら削除してから追加してください`,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const ref: SelfMotivationYoutubeRef = {
      id: generateRefId(),
      url: normalizeYoutubeWatchUrl(videoId),
      videoId,
      title: body.title?.trim() || undefined,
      note: body.note?.trim() || undefined,
      status: "running",
      addedAt: now,
      updatedAt: now,
    };

    // まず "running" で job.json に保存（UI が即座に表示できるよう）
    let nextJob = {
      ...job,
      steps: {
        ...job.steps,
        research: {
          ...job.steps.research,
          youtubeRefs: [...existingRefs, ref],
        },
      },
    };
    await saveJob(nextJob);

    // Gemini を叩いて書き起こし生成
    try {
      const result = await transcribeYoutubeVideo({
        topic: job.topic,
        videoId,
        note: ref.note,
      });
      await writeYoutubeTranscript(jobId, videoId, result.markdown);

      const doneAt = new Date().toISOString();
      const updatedRef: SelfMotivationYoutubeRef = {
        ...ref,
        status: "done",
        transcriptPath: `jobs/${jobId}/youtube-${videoId}.md`,
        generatedAt: doneAt,
        updatedAt: doneAt,
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        error: undefined,
      };
      const refresh = await loadJob(jobId);
      const refreshedRefs = (refresh.steps.research.youtubeRefs ?? []).map(
        (r) => (r.id === ref.id ? updatedRef : r),
      );
      nextJob = {
        ...refresh,
        steps: {
          ...refresh.steps,
          research: {
            ...refresh.steps.research,
            youtubeRefs: refreshedRefs,
          },
        },
      };
      await saveJob(nextJob);
      return NextResponse.json({ ok: true, ref: updatedRef, job: nextJob });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failedAt = new Date().toISOString();
      const failedRef: SelfMotivationYoutubeRef = {
        ...ref,
        status: "error",
        error: msg,
        updatedAt: failedAt,
      };
      const refresh = await loadJob(jobId);
      const refreshedRefs = (refresh.steps.research.youtubeRefs ?? []).map(
        (r) => (r.id === ref.id ? failedRef : r),
      );
      const erroredJob = {
        ...refresh,
        steps: {
          ...refresh.steps,
          research: {
            ...refresh.steps.research,
            youtubeRefs: refreshedRefs,
          },
        },
      };
      await saveJob(erroredJob);
      return NextResponse.json(
        { ok: false, ref: failedRef, job: erroredJob, error: msg },
        { status: 500 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
