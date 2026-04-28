import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { generateImage } from "@rekishi/pipeline/image-generator";
import {
  assetKindFromPath,
  imagePathToUrl,
  loadPlan,
  repoRoot,
  savePlan,
} from "@/lib/plan";
import { deriveSeedancePrompt } from "@/lib/scene-prompts";

/** キャラ参照画像が見つからない時に使う標準テンプレート（最も中立的なヒーロー立ちポーズ） */
const CHARACTER_FALLBACK_REL =
  "packages/channels/manabilab/assets/character/v1/01-hero-front-standing.png";

export const runtime = "nodejs";
export const maxDuration = 120;

interface PostBody {
  /** ユーザーが UI で入力した変更要望（自然言語） */
  instruction: string;
  /**
   * true なら現在の画像を参照画像として渡してキャラ一貫性を保つ。
   * 未指定なら scene.assetKind が "character" のとき自動 ON。
   * （後方互換: assetKind が無いプランは imagePath から推論）
   */
  useReference?: boolean;
}

interface RouteContext {
  params: Promise<{ planId: string; index: string }>;
}

/**
 * 指定シーンの画像を Nano Banana で再生成する。
 *
 * - キャラシーン (assets/character/...) は元画像を参照画像として渡し、見た目の一貫性を保つ
 * - B-roll シーンは参照なしで自由に生成
 * - 生成結果は packages/channels/manabilab/assets/per-plan/{planId}/scene-NN-{timestamp}.png に保存
 * - plan JSON の imagePath を新しいパスに更新する
 */
export async function POST(
  request: NextRequest,
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

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  const instruction = body.instruction?.trim();
  if (!instruction) {
    return NextResponse.json(
      { ok: false, error: "instruction is required" },
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
  const currentImageAbs = path.join(root, scene.imagePath);

  // assetKind があればそれを使い、無ければ初期 path から推論する。
  // これにより 2回目以降の再生成（imagePath が per-plan/... に変わった後）も
  // キャラシーンは正しく参照画像が渡される。
  const assetKind = scene.assetKind ?? assetKindFromPath(scene.imagePath);
  const useReference = body.useReference ?? assetKind === "character";

  // 参照画像の解決:
  // - 現在の画像ファイルがあればそれを使う
  // - 無くてキャラシーンなら、ヒーロー立ちポーズ画像をブランドキャラ定義として使う
  // - 無くて B-roll なら参照なしで進む（free-form 生成）
  let referenceImages: string[] = [];
  let referenceSource: "current" | "fallback-hero" | "none" = "none";
  if (useReference) {
    if (existsSync(currentImageAbs)) {
      referenceImages = [currentImageAbs];
      referenceSource = "current";
    } else if (assetKind === "character") {
      const fallbackAbs = path.join(root, CHARACTER_FALLBACK_REL);
      if (existsSync(fallbackAbs)) {
        referenceImages = [fallbackAbs];
        referenceSource = "fallback-hero";
      }
    }
  }

  // プロンプト組み立て
  // narration / overlay の文脈と、ユーザー指示を組み合わせる
  const overlayHint = scene.overlay
    ? `\nOnscreen text overlay (do NOT include this text in the image itself, but the image should leave headroom for it): "${scene.overlay.text}".`
    : "";
  const prompt = assetKind === "character"
    ? `Reference image: the manabilab brand character (a humanoid figure with a pink brain-shaped head, flat 2D vector cartoon style, clean lines, pink and grey palette).
Generate a NEW illustration of the SAME character in a different pose/scene.
Scene description: ${instruction}
Narration context: "${scene.narration}"
Beat: ${scene.beat}.${overlayHint}
Strict requirements: maintain the original flat 2D vector cartoon style, identical proportions and color palette as the reference. Vertical 9:16 composition. No text/letters in the image.`
    : `Generate an educational B-roll illustration for a learning-science short video.
Scene description: ${instruction}
Narration context: "${scene.narration}"
Beat: ${scene.beat}.${overlayHint}
Style: clean illustration, pink/grey palette consistent with a flat 2D educational explainer. Vertical 9:16 composition. No text/letters in the image (overlay text will be added in post).`;

  // 保存先パス: per-plan/{planId}/scene-NN-{timestamp}.png（バージョン履歴を残す）
  const ts = Date.now();
  const sceneNN = String(sceneIndex).padStart(2, "0");
  const newRelPath = `packages/channels/manabilab/assets/per-plan/${planId}/scene-${sceneNN}-${ts}.png`;
  const newAbsPath = path.join(root, newRelPath);

  try {
    await generateImage(prompt, newAbsPath, { referenceImages });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        prompt,
      },
      { status: 500 },
    );
  }

  // 新しい画像に合わせた Seedance プロンプトを Gemini で自動派生。
  // 失敗してもユーザー操作を止めない（既存プロンプト維持 → 後から手動編集可能）。
  const newSeedancePrompt = await deriveSeedancePrompt({
    instruction,
    beat: scene.beat,
    narration: scene.narration,
    assetKind,
    overlayText: scene.overlay?.text ?? null,
  });

  // サイドカー JSON で生成 context を残す。後で画像を再利用する時に
  // どんな指示で作ったかが分かるようにする。
  // 同名の .json ファイルとして保存（scene-01-{ts}.png ↔ scene-01-{ts}.json）
  const metaAbsPath = newAbsPath.replace(/\.png$/, ".json");
  const metadata = {
    sceneIndex,
    planId,
    beat: scene.beat,
    narration: scene.narration,
    assetKind,
    instruction,
    prompt,
    referenceSource,
    seedancePrompt: newSeedancePrompt ?? scene.seedancePrompt,
    seedancePromptDerived: newSeedancePrompt !== null,
    overlay: scene.overlay ?? null,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(metaAbsPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");

  // plan を更新（assetKind を確実に保存しておく — 次回以降の再生成で path 推論に頼らないため）
  scene.imagePath = newRelPath;
  scene.assetKind = assetKind;
  if (newSeedancePrompt) {
    scene.seedancePrompt = newSeedancePrompt;
  }
  await savePlan("manabilab", planId, plan);

  return NextResponse.json({
    ok: true,
    sceneIndex,
    imagePath: newRelPath,
    imageUrl: imagePathToUrl("manabilab", newRelPath),
    assetKind,
    prompt,
    usedReference: useReference,
    referenceSource,
    seedancePrompt: newSeedancePrompt ?? scene.seedancePrompt,
    seedancePromptDerived: newSeedancePrompt !== null,
  });
}
