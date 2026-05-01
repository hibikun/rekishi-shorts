import { NextRequest, NextResponse } from "next/server";
import {
  extractYoutubeVideoId,
  generateYoutubeRefId,
  normalizeYoutubeWatchUrl,
  transcribeUkiyoeYoutubeVideo,
} from "@rekishi/pipeline/ukiyoe-youtube-research";
import { setChannel } from "@rekishi/shared/channel";
import type { UkiyoeYoutubeRef } from "@rekishi/shared";
import {
  UKIYOE_CHANNEL_SLUG,
  loadJob,
  saveJob,
  writeYoutubeTranscript,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PostBody {
  url?: string;
  note?: string;
  title?: string;
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

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
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
          "YouTube URL から videoId を抽出できませんでした (例: https://www.youtube.com/watch?v=XXXXXXXXXXX)",
      },
      { status: 400 },
    );
  }

  setChannel(UKIYOE_CHANNEL_SLUG);
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
    const ref: UkiyoeYoutubeRef = {
      id: generateYoutubeRefId(),
      url: normalizeYoutubeWatchUrl(videoId),
      videoId,
      title: body.title?.trim() || undefined,
      note: body.note?.trim() || undefined,
      status: "running",
      addedAt: now,
      updatedAt: now,
    };

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

    try {
      const result = await transcribeUkiyoeYoutubeVideo({
        topic: job.topic,
        videoId,
        note: ref.note,
      });
      await writeYoutubeTranscript(jobId, videoId, result.markdown);

      const doneAt = new Date().toISOString();
      const updatedRef: UkiyoeYoutubeRef = {
        ...ref,
        status: "done",
        transcriptPath: `scripts/${jobId}/youtube-${videoId}.md`,
        generatedAt: doneAt,
        updatedAt: doneAt,
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        error: undefined,
      };
      const refresh = await loadJob(jobId);
      nextJob = {
        ...refresh,
        steps: {
          ...refresh.steps,
          research: {
            ...refresh.steps.research,
            youtubeRefs: (refresh.steps.research.youtubeRefs ?? []).map((r) =>
              r.id === ref.id ? updatedRef : r,
            ),
          },
        },
      };
      await saveJob(nextJob);
      return NextResponse.json({ ok: true, ref: updatedRef, job: nextJob });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failedAt = new Date().toISOString();
      const failedRef: UkiyoeYoutubeRef = {
        ...ref,
        status: "error",
        error: msg,
        updatedAt: failedAt,
      };
      const refresh = await loadJob(jobId);
      nextJob = {
        ...refresh,
        steps: {
          ...refresh.steps,
          research: {
            ...refresh.steps.research,
            youtubeRefs: (refresh.steps.research.youtubeRefs ?? []).map((r) =>
              r.id === ref.id ? failedRef : r,
            ),
          },
        },
      };
      await saveJob(nextJob);
      return NextResponse.json(
        { ok: false, ref: failedRef, job: nextJob, error: msg },
        { status: 500 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
