import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { generateSceneTts } from "@rekishi/pipeline";
import { setChannel } from "@rekishi/shared/channel";
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
// Gemini TTS preview は 1 シーンあたり 5〜30 秒程度
export const maxDuration = 180;

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
}

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, index: rawIndex } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  const sceneIndex = Number(rawIndex);
  if (!Number.isInteger(sceneIndex) || sceneIndex < 1) {
    return NextResponse.json(
      { ok: false, error: "scene index は 1 以上の整数で指定してください" },
      { status: 400 },
    );
  }

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
  if (!scenes) {
    return NextResponse.json(
      { ok: false, error: "scenes.json が読めません" },
      { status: 400 },
    );
  }

  const target = scenes.find((s) => s.index === sceneIndex);
  if (!target) {
    return NextResponse.json(
      { ok: false, error: `scene #${sceneIndex} が見つかりません` },
      { status: 404 },
    );
  }

  const text = target.narration?.trim();
  if (!text) {
    return NextResponse.json(
      { ok: false, error: "narration が空のシーンは TTS 生成できません" },
      { status: 400 },
    );
  }

  // script.json から readings を取得（誤読対策）
  const script = await readScriptJson(jobId);
  const readings = readingsArrayToRecord(script?.readings);

  const fileName = `scene-${String(sceneIndex).padStart(2, "0")}.wav`;
  const destAbs = path.join(jobDir(jobId), "audio", fileName);
  const relFromChannel = path.join("jobs", jobId, "audio", fileName);

  try {
    setChannel(CANVA_CHANNEL_SLUG);
    const result = await generateSceneTts({
      text,
      destPath: destAbs,
      voiceName: job.steps.tts.voiceName,
      stylePromptOverride: job.steps.tts.stylePromptOverride,
      modelOverride: job.steps.tts.ttsModel,
      readings,
    });

    const now = new Date().toISOString();
    const nextScenes = scenes.map((s) =>
      s.index === sceneIndex
        ? {
            ...s,
            audioPath: relFromChannel,
            audioDurationSec: result.durationSec,
            audioGeneratedAt: now,
          }
        : s,
    );
    await writeScenesJson(jobId, nextScenes);

    // 全 scene に audio が揃ったら steps.tts を done に。1 つでも生成されたら in-progress に。
    const allHave = nextScenes.every((s) => !!s.audioPath);
    const someHave = nextScenes.some((s) => !!s.audioPath);
    let nextStatus = job.steps.tts.status;
    if (allHave) nextStatus = "done";
    else if (someHave && nextStatus === "pending") nextStatus = "in-progress";
    await saveJob({
      ...job,
      steps: {
        ...job.steps,
        tts: {
          ...job.steps.tts,
          status: nextStatus,
          updatedAt: now,
          error: undefined,
        },
      },
    });

    const audioUrl = `/${CANVA_CHANNEL_SLUG}/${relFromChannel}?t=${Date.now()}`;

    return NextResponse.json({
      ok: true,
      sceneIndex,
      audioPath: relFromChannel,
      audioUrl,
      audioDurationSec: result.durationSec,
      generatedAt: now,
      voiceName: job.steps.tts.voiceName,
      model: result.model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
