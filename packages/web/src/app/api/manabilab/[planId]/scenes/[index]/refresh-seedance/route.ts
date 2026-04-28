import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assetKindFromPath,
  loadPlan,
  repoRoot,
  savePlan,
} from "@/lib/plan";
import {
  describeImageWithVision,
  deriveSeedancePrompt,
} from "@/lib/scene-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ planId: string; index: string }>;
}

/**
 * 既存画像に対して Seedance プロンプトだけを更新する。
 *
 * 1. シーンの imagePath が指す画像を Gemini Vision に渡して内容を日本語で記述させる
 * 2. その記述 + scene 文脈で Seedance プロンプトを派生
 * 3. plan.scenes[i].seedancePrompt を更新
 *
 * 画像生成（Nano Banana）を伴わないので、再生成より大幅に安く速い。
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { planId, index: indexStr } = await context.params;
  const sceneIndex = Number.parseInt(indexStr, 10);
  if (Number.isNaN(sceneIndex)) {
    return NextResponse.json(
      { ok: false, error: `invalid scene index: ${indexStr}` },
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

  const root = repoRoot();
  const imageAbs = path.join(root, scene.imagePath);
  if (!existsSync(imageAbs)) {
    return NextResponse.json(
      {
        ok: false,
        error: `image not found on disk: ${scene.imagePath}`,
      },
      { status: 404 },
    );
  }

  // Step 1: Gemini Vision で画像内容を記述
  const description = await describeImageWithVision(imageAbs);
  if (!description) {
    return NextResponse.json(
      {
        ok: false,
        error: "vision describe failed (Gemini API error or empty response)",
      },
      { status: 500 },
    );
  }

  // Step 2: 記述 + scene 文脈で Seedance プロンプトを派生
  const assetKind = scene.assetKind ?? assetKindFromPath(scene.imagePath);
  const newSeedancePrompt = await deriveSeedancePrompt({
    instruction: description,
    beat: scene.beat,
    narration: scene.narration,
    assetKind,
    overlayText: scene.overlay?.text ?? null,
  });
  if (!newSeedancePrompt) {
    return NextResponse.json(
      {
        ok: false,
        error: "seedance prompt derivation failed",
        description,
      },
      { status: 500 },
    );
  }

  // Step 3: plan を更新
  const oldPrompt = scene.seedancePrompt;
  scene.seedancePrompt = newSeedancePrompt;
  scene.assetKind = assetKind;
  await savePlan("manabilab", planId, plan);

  // 既存サイドカー JSON があれば更新（無ければ新規作成）
  const metaAbsPath = imageAbs.replace(/\.png$/, ".json");
  const metadata = {
    sceneIndex,
    planId,
    beat: scene.beat,
    narration: scene.narration,
    assetKind,
    visionDescription: description,
    seedancePrompt: newSeedancePrompt,
    seedancePromptDerived: true,
    overlay: scene.overlay ?? null,
    refreshedAt: new Date().toISOString(),
  };
  await writeFile(metaAbsPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");

  return NextResponse.json({
    ok: true,
    sceneIndex,
    description,
    seedancePrompt: newSeedancePrompt,
    oldPrompt,
  });
}
