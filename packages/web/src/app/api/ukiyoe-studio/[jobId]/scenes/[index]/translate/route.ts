import { NextRequest, NextResponse } from "next/server";
import { translateVideoPromptJaToEn } from "@/lib/scene-prompts";
import {
  readScenePlanJson,
  writeScenePlanJson,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
}

interface PostBody {
  ja?: string;
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, index: rawIndex } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  const sceneIndex = Number.parseInt(rawIndex, 10);

  if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
    return NextResponse.json(
      { ok: false, error: `invalid scene index: ${rawIndex}` },
      { status: 400 },
    );
  }

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const ja = (body.ja ?? "").trim();
  if (!ja) {
    return NextResponse.json(
      { ok: false, error: "ja is required (non-empty)" },
      { status: 400 },
    );
  }

  const plan = await readScenePlanJson(jobId);
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: "scene-plan.json が見つかりません" },
      { status: 404 },
    );
  }
  const scene = plan.scenes.find((s) => s.index === sceneIndex);
  if (!scene) {
    return NextResponse.json(
      { ok: false, error: `scene ${sceneIndex} が plan に存在しません` },
      { status: 404 },
    );
  }

  const en = await translateVideoPromptJaToEn({
    ja,
    context: {
      channel: "ukiyoe",
      topic: plan.topic,
      narration: scene.narration,
      actionTag: scene.actionTag,
      cameraFixed: scene.cameraFixed,
    },
  });

  if (!en) {
    return NextResponse.json(
      { ok: false, error: "translation failed (Gemini error or empty response)" },
      { status: 500 },
    );
  }

  scene.videoPrompt = en;
  scene.videoPromptJa = ja;
  await writeScenePlanJson(jobId, plan);

  return NextResponse.json({ ok: true, sceneIndex, ja, en });
}
