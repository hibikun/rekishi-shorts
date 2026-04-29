import { NextRequest, NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  audioDir,
  generateSceneTts,
  loadJob,
  readScenesJson,
  readScriptJson,
  relFromChannelRoot,
  saveJob,
  sceneAudioPath,
  writeScenesJson,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";
export const maxDuration = 900;

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  try {
    setChannel(SELF_MOTIVATION_CHANNEL);
    const job = await loadJob(jobId);
    const script = await readScriptJson(jobId);
    const scenes = await readScenesJson(jobId);
    if (!script || !scenes) {
      return NextResponse.json(
        { ok: false, error: "script / scenes が無い" },
        { status: 400 },
      );
    }

    await mkdir(audioDir(jobId), { recursive: true });

    const readingsRecord: Record<string, string> = {};
    for (const r of script.readings ?? []) {
      if (r.term && r.reading) readingsRecord[r.term] = r.reading;
    }

    const voice = job.steps.tts.voiceName ?? "Charon";
    const errors: Array<{ sceneId: string; error: string }> = [];
    let updated = [...scenes];
    let processedCount = 0;

    for (const scene of scenes) {
      if (scene.audioPath && scene.audioDurationSec) continue;
      try {
        const dest = sceneAudioPath(jobId, scene.sceneId);
        const r = await generateSceneTts({
          text: scene.narration,
          destPath: dest,
          voiceName: voice,
          readings: readingsRecord,
        });
        const now = new Date().toISOString();
        updated = updated.map((s) =>
          s.sceneId === scene.sceneId
            ? {
                ...s,
                audioPath: relFromChannelRoot(dest),
                audioDurationSec: r.durationSec,
                audioGeneratedAt: now,
              }
            : s,
        );
        await writeScenesJson(jobId, updated);
        processedCount += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ sceneId: scene.sceneId, error: msg });
      }
    }

    const allDone = updated.every((s) => !!s.audioPath && !!s.audioDurationSec);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        tts: {
          ...job.steps.tts,
          status: (allDone ? "done" : errors.length > 0 ? "error" : "pending") as
            | "done"
            | "error"
            | "pending",
          updatedAt: now,
          error: errors.length > 0 ? `${errors.length} 件失敗` : undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: errors.length === 0,
      processedCount,
      errors,
      job: next,
      scenes: updated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
