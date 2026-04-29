import { NextRequest, NextResponse } from "next/server";
import { loadUkiyoePlan, saveUkiyoePlan } from "@/lib/ukiyoe-plan";
import { translateVideoPromptJaToEn } from "@/lib/scene-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PostBody {
  index: number;
  ja: string;
}

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/**
 * 日本語 videoPrompt をシーン文脈で英訳し、Seedance 送信用の英語版を返す。
 * plan の videoPromptJa / videoPrompt を更新して保存する。
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { jobId } = await context.params;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const sceneIndex = Number(body.index);
  if (!Number.isInteger(sceneIndex)) {
    return NextResponse.json(
      { ok: false, error: `invalid scene index: ${body.index}` },
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

  const plan = await loadUkiyoePlan(jobId);
  const scene = plan.scenes.find((s) => s.index === sceneIndex);
  if (!scene) {
    return NextResponse.json(
      { ok: false, error: `scene ${sceneIndex} not found in ${jobId}` },
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
      {
        ok: false,
        error: "translation failed (Gemini error or empty response)",
      },
      { status: 500 },
    );
  }

  scene.videoPrompt = en;
  scene.videoPromptJa = ja;
  await saveUkiyoePlan(jobId, plan);

  return NextResponse.json({
    ok: true,
    sceneIndex,
    en,
    ja,
  });
}
