import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { ffmpegConcatWavs } from "@rekishi/pipeline";
import {
  jobDir,
  loadJob,
  readScenesJson,
  saveJob,
} from "@/lib/canva-job";

export const runtime = "nodejs";
// 18 シーン × 数十 KB の concat なので通常 1 秒以下。多少の余裕を持たせる。
export const maxDuration = 120;

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

  const scenes = await readScenesJson(jobId);
  if (!scenes || scenes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "scenes.json が読めません" },
      { status: 400 },
    );
  }

  const sorted = [...scenes].sort((a, b) => a.index - b.index);
  const missing = sorted.filter((s) => !s.audioPath);
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `未生成のシーンがあります: #${missing
          .map((s) => s.index)
          .join(", #")}`,
      },
      { status: 400 },
    );
  }

  const audioDir = path.join(jobDir(jobId), "audio");
  await mkdir(audioDir, { recursive: true });
  const inputs: string[] = [];
  for (const s of sorted) {
    // audioPath は 'jobs/{jobId}/audio/scene-NN.wav' (channels/manabilab-canva 起点)
    const channelRoot = path.dirname(path.dirname(jobDir(jobId)));
    const abs = path.join(channelRoot, s.audioPath as string);
    try {
      const st = await stat(abs);
      if (!st.isFile()) {
        return NextResponse.json(
          { ok: false, error: `#${s.index}: audio file is not a file: ${s.audioPath}` },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: `#${s.index}: audio file が見つかりません: ${s.audioPath}`,
        },
        { status: 400 },
      );
    }
    inputs.push(abs);
  }

  const outName = "full.wav";
  const outAbs = path.join(audioDir, outName);
  const outRel = path.join("jobs", jobId, "audio", outName);

  try {
    await ffmpegConcatWavs(inputs, outAbs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `ffmpeg concat 失敗: ${msg}` },
      { status: 500 },
    );
  }

  const totalDurationSec = sorted.reduce(
    (acc, s) => acc + (s.audioDurationSec ?? 0),
    0,
  );
  const now = new Date().toISOString();
  const nextJob = {
    ...job,
    steps: {
      ...job.steps,
      tts: {
        ...job.steps.tts,
        concatAudioPath: outRel,
        concatDurationSec: totalDurationSec,
        concatGeneratedAt: now,
      },
    },
  };
  await saveJob(nextJob);

  return NextResponse.json({
    ok: true,
    job: nextJob,
    audioPath: outRel,
    audioUrl: `/manabilab-canva/${outRel}`,
    durationSec: totalDurationSec,
    generatedAt: now,
  });
}
