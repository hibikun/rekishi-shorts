import { NextRequest, NextResponse } from "next/server";
import { generateImagePromptForScene } from "@rekishi/pipeline";
import { setChannel } from "@rekishi/shared/channel";
import {
  CANVA_CHANNEL_SLUG,
  loadJob,
  readScenesJson,
  writeScenesJson,
} from "@/lib/canva-job";

export const runtime = "nodejs";
export const maxDuration = 120;

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
      {
        ok: false,
        error: "scenes.json が読めません。Scenes ステップから展開してください",
      },
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

  try {
    setChannel(CANVA_CHANNEL_SLUG);
    const result = await generateImagePromptForScene(target, job.topic);

    const nextScenes = scenes.map((s) =>
      s.index === sceneIndex
        ? { ...s, imagePromptEn: result.imagePromptEn }
        : s,
    );
    await writeScenesJson(jobId, nextScenes);

    return NextResponse.json({
      ok: true,
      sceneIndex,
      imagePromptEn: result.imagePromptEn,
      poseSummaryJa: result.poseSummaryJa,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
