import { NextRequest, NextResponse } from "next/server";
import { synthesizeNarration } from "@rekishi/pipeline/tts-generator";
import { FURIGANA_MAP } from "@rekishi/pipeline/furigana";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  loadJob,
  narrationWavPath,
  readScriptJson,
  saveJob,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
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
      { ok: false, error: "script.json が見つからないか壊れています" },
      { status: 400 },
    );
  }

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      tts: {
        ...job.steps.tts,
        status: "in-progress",
        updatedAt: startNow,
        error: undefined,
      },
    },
  });

  try {
    setChannel(UKIYOE_CHANNEL_SLUG);
    const result = await synthesizeNarration(
      script.narration,
      narrationWavPath(jobId),
      {
        readings: script.readings,
        furigana: FURIGANA_MAP,
        hook: script.hook,
        voiceName: job.steps.tts.voiceName,
        modelOverride: job.steps.tts.ttsModel,
      },
    );

    const doneNow = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        tts: {
          ...job.steps.tts,
          status: "done" as const,
          updatedAt: doneNow,
          characters: result.characters,
          approxDurationSec: result.approxDurationSec,
          ttsModel: result.usage.model,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: true,
      job: next,
      tts: {
        path: result.path,
        characters: result.characters,
        approxDurationSec: result.approxDurationSec,
        model: result.usage.model,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed = await loadJob(jobId);
    await saveJob({
      ...failed,
      steps: {
        ...failed.steps,
        tts: {
          ...failed.steps.tts,
          status: "error",
          updatedAt: new Date().toISOString(),
          error: msg,
        },
      },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
