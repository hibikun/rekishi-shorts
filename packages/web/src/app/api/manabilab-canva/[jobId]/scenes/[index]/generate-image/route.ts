import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { stat } from "node:fs/promises";
import { generateImagePromptForScene } from "@rekishi/pipeline";
import { generateImage } from "@rekishi/pipeline/image-generator";
import { setChannel } from "@rekishi/shared/channel";
import {
  CANVA_CHANNEL_SLUG,
  loadJob,
  jobDir,
  readScenesJson,
  writeScenesJson,
} from "@/lib/canva-job";

export const runtime = "nodejs";
export const maxDuration = 240;

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
}

interface PostBody {
  /** ユーザーの日本語ポーズ指示（任意）。未指定なら scene.imagePromptJa を使う */
  userDirectionJa?: string;
  /** 既存の imagePromptEn が残っていても、必ず Gemini で再生成する。default true */
  regeneratePrompt?: boolean;
}

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

function characterRefPath(): string {
  return path.join(
    REPO_ROOT,
    "packages",
    "channels",
    CANVA_CHANNEL_SLUG,
    "assets",
    "character",
    "manabikun-base.png",
  );
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, index: rawIndex } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  const sceneIndex = Number(rawIndex);
  if (!Number.isInteger(sceneIndex) || sceneIndex < 1) {
    return NextResponse.json(
      { ok: false, error: "scene index は 1 以上の整数で指定してください" },
      { status: 400 },
    );
  }

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // body 無し OK
  }
  const userDirectionJa = (body.userDirectionJa ?? "").trim();
  // ユーザー指示があれば常に再生成。なければ既存 imagePromptEn が無い時だけ生成
  const shouldRegeneratePrompt = body.regeneratePrompt !== false;

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

  const refPath = characterRefPath();
  try {
    await stat(refPath);
  } catch {
    return NextResponse.json(
      { ok: false, error: `参照画像が見つかりません: ${refPath}` },
      { status: 500 },
    );
  }

  // Step 1: ユーザー指示を imagePromptJa に保存し、必要なら imagePromptEn を再生成
  let promptEn = target.imagePromptEn ?? "";
  let promptRegenerated = false;
  let updatedScene = { ...target, imagePromptJa: userDirectionJa };

  const needsRegenerate =
    shouldRegeneratePrompt || !promptEn.trim() || userDirectionJa.length > 0;

  if (needsRegenerate) {
    try {
      setChannel(CANVA_CHANNEL_SLUG);
      const r = await generateImagePromptForScene(
        updatedScene,
        job.topic,
        userDirectionJa || undefined,
      );
      promptEn = r.imagePromptEn;
      updatedScene = { ...updatedScene, imagePromptEn: promptEn };
      promptRegenerated = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: `プロンプト生成に失敗しました: ${msg}` },
        { status: 500 },
      );
    }
  }

  if (!promptEn.trim()) {
    return NextResponse.json(
      { ok: false, error: "imagePromptEn が空のままです" },
      { status: 500 },
    );
  }

  // 中間状態保存（プロンプトが更新されている場合に備えて）
  const scenesAfterPrompt = scenes.map((s) =>
    s.index === sceneIndex ? updatedScene : s,
  );
  await writeScenesJson(jobId, scenesAfterPrompt);

  // Step 2: Nano Banana で画像生成
  const fileName = `scene-${String(sceneIndex).padStart(2, "0")}.png`;
  const destAbs = path.join(jobDir(jobId), "images", fileName);
  const relFromChannel = path.join("jobs", jobId, "images", fileName);

  try {
    await generateImage(promptEn, destAbs, {
      referenceImages: [refPath],
      appendAspectSuffix: false,
    });

    const now = new Date().toISOString();
    const finalScene = {
      ...updatedScene,
      imagePath: relFromChannel,
      imageGeneratedAt: now,
    };
    const finalScenes = scenes.map((s) =>
      s.index === sceneIndex ? finalScene : s,
    );
    await writeScenesJson(jobId, finalScenes);

    const imageUrl = `/${CANVA_CHANNEL_SLUG}/${relFromChannel}?t=${Date.now()}`;

    return NextResponse.json({
      ok: true,
      sceneIndex,
      imagePath: relFromChannel,
      imageUrl,
      generatedAt: now,
      imagePromptEn: promptEn,
      imagePromptJa: userDirectionJa,
      promptRegenerated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
