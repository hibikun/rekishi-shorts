import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { stat } from "node:fs/promises";
import {
  generateAnimationPromptForScene,
  generateAnimationForScene,
} from "@rekishi/pipeline";
import { setChannel } from "@rekishi/shared/channel";
import {
  CANVA_CHANNEL_SLUG,
  jobDir,
  loadJob,
  readScenesJson,
  writeScenesJson,
} from "@/lib/canva-job";

export const runtime = "nodejs";
// Seedance img2video は数十秒〜数分かかる
export const maxDuration = 600;

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
}

interface PostBody {
  /** ユーザーの日本語アニメ指示（任意） */
  userDirectionJa?: string;
  /** 既存の seedancePromptEn が残っていても、必ず Gemini で再生成する。default true */
  regeneratePrompt?: boolean;
  /** 解像度。default 720p */
  resolution?: "480p" | "720p";
  /** 動画長さ（秒）。default 5 */
  durationSec?: number;
}

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

function imageAbsPath(jobId: string, relFromChannel: string): string {
  // relFromChannel は "jobs/{jobId}/images/scene-XX.png" のような形式
  return path.join(
    REPO_ROOT,
    "packages",
    "channels",
    CANVA_CHANNEL_SLUG,
    relFromChannel,
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
  const shouldRegeneratePrompt = body.regeneratePrompt !== false;
  const resolution = body.resolution ?? "720p";
  const durationSec = body.durationSec ?? 5;

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

  if (!target.imagePath) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "このシーンに静止画がありません。先に「画像を生成」で PNG を作ってください",
      },
      { status: 400 },
    );
  }

  const imageAbs = imageAbsPath(jobId, target.imagePath);
  try {
    await stat(imageAbs);
  } catch {
    return NextResponse.json(
      { ok: false, error: `画像ファイルが見つかりません: ${imageAbs}` },
      { status: 400 },
    );
  }

  // Step 1: ユーザー指示を保存しつつ、英語アニメプロンプトを生成
  let promptEn = target.seedancePromptEn ?? "";
  let updatedScene = { ...target, seedancePromptJa: userDirectionJa };

  const needsRegenerate =
    shouldRegeneratePrompt || !promptEn.trim() || userDirectionJa.length > 0;

  if (needsRegenerate) {
    try {
      setChannel(CANVA_CHANNEL_SLUG);
      const r = await generateAnimationPromptForScene(
        updatedScene,
        job.topic,
        userDirectionJa || undefined,
      );
      promptEn = r.animationPromptEn;
      updatedScene = { ...updatedScene, seedancePromptEn: promptEn };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: `アニメプロンプト生成に失敗しました: ${msg}` },
        { status: 500 },
      );
    }
  }

  if (!promptEn.trim()) {
    return NextResponse.json(
      { ok: false, error: "seedancePromptEn が空のままです" },
      { status: 500 },
    );
  }

  // 中間状態保存
  const scenesAfterPrompt = scenes.map((s) =>
    s.index === sceneIndex ? updatedScene : s,
  );
  await writeScenesJson(jobId, scenesAfterPrompt);

  // Step 2: Seedance img2video
  const fileName = `scene-${String(sceneIndex).padStart(2, "0")}.mp4`;
  const destAbs = path.join(jobDir(jobId), "videos", fileName);
  const relFromChannel = path.join("jobs", jobId, "videos", fileName);

  try {
    await generateAnimationForScene({
      imagePath: imageAbs,
      outputPath: destAbs,
      prompt: promptEn,
      resolution,
      durationSec,
    });

    const now = new Date().toISOString();
    const finalScene = {
      ...updatedScene,
      videoPath: relFromChannel,
      videoGeneratedAt: now,
    };
    const finalScenes = scenes.map((s) =>
      s.index === sceneIndex ? finalScene : s,
    );
    await writeScenesJson(jobId, finalScenes);

    const videoUrl = `/${CANVA_CHANNEL_SLUG}/${relFromChannel}?t=${Date.now()}`;

    return NextResponse.json({
      ok: true,
      sceneIndex,
      videoPath: relFromChannel,
      videoUrl,
      generatedAt: now,
      seedancePromptEn: promptEn,
      seedancePromptJa: userDirectionJa,
      resolution,
      durationSec,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
