import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { generateSceneTts } from "@rekishi/pipeline";
import { setChannel } from "@rekishi/shared/channel";
import type { ManabilabCanvaScene } from "@rekishi/shared";
import {
  CANVA_CHANNEL_SLUG,
  jobDir,
  loadJob,
  readScenesJson,
  readScriptJson,
  readingsArrayToRecord,
  saveJob,
  writeScenesJson,
} from "@/lib/canva-job";

export const runtime = "nodejs";
// 6 シーン × 10〜30 秒 ≒ 1〜3 分。429 リトライも考慮して長め。
export const maxDuration = 600;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PostBody {
  /** 既存音声を上書きするか。default false (skip-existing) */
  force?: boolean;
}

interface PerSceneResult {
  index: number;
  status: "done" | "skipped" | "error";
  audioPath?: string;
  audioDurationSec?: number;
  error?: string;
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // body 無し OK
  }
  const force = body.force === true;

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

  let scenes = await readScenesJson(jobId);
  if (!scenes) {
    return NextResponse.json(
      { ok: false, error: "scenes.json が読めません" },
      { status: 400 },
    );
  }

  const script = await readScriptJson(jobId);
  const readings = readingsArrayToRecord(script?.readings);

  // in-progress に
  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      tts: { ...job.steps.tts, status: "in-progress", updatedAt: startNow },
    },
  });

  setChannel(CANVA_CHANNEL_SLUG);
  const results: PerSceneResult[] = [];

  for (const scene of scenes) {
    try {
      const text = scene.narration?.trim() ?? "";
      if (!text) {
        results.push({
          index: scene.index,
          status: "error",
          error: "narration が空",
        });
        continue;
      }
      if (scene.audioPath && !force) {
        results.push({
          index: scene.index,
          status: "skipped",
          audioPath: scene.audioPath,
          audioDurationSec: scene.audioDurationSec,
        });
        continue;
      }

      const fileName = `scene-${String(scene.index).padStart(2, "0")}.wav`;
      const destAbs = path.join(jobDir(jobId), "audio", fileName);
      const relFromChannel = path.join("jobs", jobId, "audio", fileName);

      const r = await generateSceneTts({
        text,
        destPath: destAbs,
        voiceName: job.steps.tts.voiceName,
        stylePromptOverride: job.steps.tts.stylePromptOverride,
        modelOverride: job.steps.tts.ttsModel,
        readings,
      });

      const now = new Date().toISOString();
      scenes = scenes!.map((s: ManabilabCanvaScene) =>
        s.index === scene.index
          ? {
              ...s,
              audioPath: relFromChannel,
              audioDurationSec: r.durationSec,
              audioGeneratedAt: now,
            }
          : s,
      );
      await writeScenesJson(jobId, scenes);

      results.push({
        index: scene.index,
        status: "done",
        audioPath: relFromChannel,
        audioDurationSec: r.durationSec,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ index: scene.index, status: "error", error: msg });
    }
  }

  const allHave = scenes!.every((s: ManabilabCanvaScene) => !!s.audioPath);
  const anyError = results.some((r) => r.status === "error");
  const doneNow = new Date().toISOString();
  const nextStatus: "done" | "error" | "in-progress" = allHave
    ? "done"
    : anyError
    ? "error"
    : "in-progress";
  const nextJob = {
    ...job,
    steps: {
      ...job.steps,
      tts: {
        ...job.steps.tts,
        status: nextStatus,
        updatedAt: doneNow,
        error: anyError
          ? results
              .filter((r) => r.status === "error")
              .map((r) => `#${r.index}: ${r.error}`)
              .join(" / ")
          : undefined,
      },
    },
  };
  await saveJob(nextJob);

  return NextResponse.json({
    ok: !anyError,
    job: nextJob,
    scenes,
    results,
  });
}
