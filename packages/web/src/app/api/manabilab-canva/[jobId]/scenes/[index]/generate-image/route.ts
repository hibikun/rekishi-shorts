import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { stat } from "node:fs/promises";
import { generateImage } from "@rekishi/pipeline/image-generator";
import {
  CANVA_CHANNEL_SLUG,
  jobDir,
  loadJob,
  readScenesJson,
  writeScenesJson,
} from "@/lib/canva-job";

export const runtime = "nodejs";
export const maxDuration = 180;

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
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

  try {
    await loadJob(jobId);
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

  const promptEn = target.imagePromptEn?.trim();
  if (!promptEn) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "imagePromptEn が空です。先に「ポーズプロンプトを再生成」を押してください",
      },
      { status: 400 },
    );
  }

  const refPath = characterRefPath();
  try {
    await stat(refPath);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: `参照画像が見つかりません: ${refPath}`,
      },
      { status: 500 },
    );
  }

  const fileName = `scene-${String(sceneIndex).padStart(2, "0")}.png`;
  const destAbs = path.join(jobDir(jobId), "images", fileName);
  // jobs/{jobId}/images/scene-XX.png （manabilab-canva 起点）
  const relFromChannel = path.join("jobs", jobId, "images", fileName);

  try {
    await generateImage(promptEn, destAbs, {
      referenceImages: [refPath],
      appendAspectSuffix: false, // 明示的にプロンプト内で 9:16 を指定済み
    });

    const now = new Date().toISOString();
    const nextScenes = scenes.map((s) =>
      s.index === sceneIndex
        ? { ...s, imagePath: relFromChannel, imageGeneratedAt: now }
        : s,
    );
    await writeScenesJson(jobId, nextScenes);

    // public symlink (packages/web/public/manabilab-canva → channels/manabilab-canva)
    // 経由で URL アクセス可能。キャッシュバスタ用に updatedAt を付ける
    const imageUrl = `/${CANVA_CHANNEL_SLUG}/${relFromChannel}?t=${Date.now()}`;

    return NextResponse.json({
      ok: true,
      sceneIndex,
      imagePath: relFromChannel,
      imageUrl,
      generatedAt: now,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
