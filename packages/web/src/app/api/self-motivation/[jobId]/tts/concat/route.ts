import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  audioDir,
  channelRootDir,
  concatAudioPath,
  concatSelfMotivationTts,
  loadJob,
  readScenesJson,
  relFromChannelRoot,
  saveJob,
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
    const job = await loadJob(jobId);
    const scenes = await readScenesJson(jobId);
    if (!scenes) {
      return NextResponse.json(
        { ok: false, error: "scenes が無い" },
        { status: 400 },
      );
    }
    const inputs = scenes
      .filter((s) => s.audioPath)
      .map((s) => ({
        sceneId: s.sceneId,
        audioPath: path.join(channelRootDir(), s.audioPath as string),
      }));
    if (inputs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "音声がまだ生成されていません" },
        { status: 400 },
      );
    }
    const outAbs = concatAudioPath(jobId);
    void audioDir; // import が使用されるよう保持
    const r = await concatSelfMotivationTts(inputs, outAbs);

    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        tts: {
          ...job.steps.tts,
          concatAudioPath: relFromChannelRoot(outAbs),
          concatDurationSec: r.totalDurationSec,
          concatGeneratedAt: now,
          updatedAt: now,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: true,
      job: next,
      durationSec: r.totalDurationSec,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
