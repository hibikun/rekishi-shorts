import { NextRequest, NextResponse } from "next/server";
import { assetKindFromPath, loadPlan, savePlan } from "@/lib/plan";
import { translateVideoPromptJaToEn } from "@/lib/scene-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PostBody {
  index: number;
  ja: string;
}

interface RouteContext {
  params: Promise<{ planId: string }>;
}

/**
 * 日本語 seedancePrompt をシーン文脈で英訳し、Seedance 送信用の英語版を返す。
 * plan の seedancePromptJa / seedancePrompt を更新して保存する。
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { planId } = await context.params;

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

  const plan = await loadPlan("manabilab", planId);
  const scene = plan.scenes.find((s) => s.index === sceneIndex);
  if (!scene) {
    return NextResponse.json(
      { ok: false, error: `scene ${sceneIndex} not found in ${planId}` },
      { status: 404 },
    );
  }
  if (scene.kind !== "image") {
    return NextResponse.json(
      { ok: false, error: `scene ${sceneIndex} is not an image scene` },
      { status: 400 },
    );
  }

  const assetKind = scene.assetKind ?? assetKindFromPath(scene.imagePath);
  const en = await translateVideoPromptJaToEn({
    ja,
    context: {
      channel: "manabilab",
      narration: scene.narration,
      beat: scene.beat,
      assetKind,
      overlayText: scene.overlay?.text ?? null,
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

  scene.seedancePrompt = en;
  scene.seedancePromptJa = ja;
  await savePlan("manabilab", planId, plan);

  return NextResponse.json({
    ok: true,
    sceneIndex,
    en,
    ja,
  });
}
