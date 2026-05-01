import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  channelRootDir,
  generateAnimationPromptForScene,
  generateLongformAnimation,
  loadJob,
  readScenesJson,
  readScriptJson,
  relFromChannelRoot,
  sceneVideoPath,
  videosDir,
  writeScenesJson,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";
// Seedance img2video は数十秒〜数分かかる
export const maxDuration = 600;

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string; sceneId: string }>;
}

interface PostBody {
  /** ユーザーの日本語アニメ指示（任意） */
  userDirection?: string;
  /** 既存の videoPromptEn が残っていても、必ず Gemini で再生成する。default true */
  regeneratePrompt?: boolean;
  /** 解像度。default 720p */
  resolution?: "480p" | "720p";
  /** 動画長さ（秒）。default 5 */
  durationSec?: number;
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, sceneId: rawSceneId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  const sceneId = decodeURIComponent(rawSceneId);

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // body 無し OK
  }
  const userDirection = (body.userDirection ?? "").trim();
  const shouldRegeneratePrompt = body.regeneratePrompt !== false;
  const resolution: "480p" | "720p" = body.resolution ?? "720p";
  const durationSec = body.durationSec ?? 5;

  try {
    setChannel(SELF_MOTIVATION_CHANNEL);
    const job = await loadJob(jobId);
    const script = await readScriptJson(jobId);
    const scenes = await readScenesJson(jobId);
    if (!script || !scenes) {
      return NextResponse.json(
        { ok: false, error: "script / scenes が無い" },
        { status: 400 },
      );
    }

    const target = scenes.find((s) => s.sceneId === sceneId);
    if (!target) {
      return NextResponse.json(
        { ok: false, error: `scene ${sceneId} が見つかりません` },
        { status: 404 },
      );
    }

    if (!target.imagePath) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "このシーンに静止画がありません。先に「🎨 画像」で生成してください",
        },
        { status: 400 },
      );
    }

    const imageAbs = path.resolve(channelRootDir(), target.imagePath);
    try {
      await stat(imageAbs);
    } catch {
      return NextResponse.json(
        { ok: false, error: `画像ファイルが見つかりません: ${imageAbs}` },
        { status: 400 },
      );
    }

    // Step 1: ユーザー指示を保存しつつ、英語アニメプロンプトを生成
    let videoPromptEn = target.videoPromptEn ?? "";
    let updatedScene = { ...target, videoPromptJa: userDirection };

    const needsRegenerate =
      shouldRegeneratePrompt ||
      !videoPromptEn.trim() ||
      userDirection.length > 0;

    if (needsRegenerate) {
      try {
        const r = await generateAnimationPromptForScene(
          updatedScene,
          script,
          job.topic,
          userDirection,
        );
        videoPromptEn = r.videoPromptEn;
        updatedScene = { ...updatedScene, videoPromptEn };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { ok: false, error: `アニメプロンプト生成に失敗しました: ${msg}` },
          { status: 500 },
        );
      }
    }

    if (!videoPromptEn.trim()) {
      return NextResponse.json(
        { ok: false, error: "videoPromptEn が空のままです" },
        { status: 500 },
      );
    }

    // 中間状態保存（プロンプトだけ先に確定）
    const scenesAfterPrompt = scenes.map((s) =>
      s.sceneId === sceneId ? updatedScene : s,
    );
    await writeScenesJson(jobId, scenesAfterPrompt);

    // Step 2: Seedance img2video
    await mkdir(videosDir(jobId), { recursive: true });
    const destAbs = sceneVideoPath(jobId, sceneId);

    try {
      const r = await generateLongformAnimation({
        imagePath: imageAbs,
        outputPath: destAbs,
        prompt: videoPromptEn,
        resolution,
        durationSec,
      });

      const now = new Date().toISOString();
      const finalScene = {
        ...updatedScene,
        videoPath: relFromChannelRoot(destAbs),
        videoDurationSec: r.durationSec,
        videoResolution: r.resolution,
        videoGeneratedAt: now,
      };
      const finalScenes = scenesAfterPrompt.map((s) =>
        s.sceneId === sceneId ? finalScene : s,
      );
      await writeScenesJson(jobId, finalScenes);

      const videoUrl = `/${SELF_MOTIVATION_CHANNEL}/${relFromChannelRoot(destAbs)}?t=${Date.now()}`;

      return NextResponse.json({
        ok: true,
        sceneId,
        videoPath: finalScene.videoPath,
        videoUrl,
        videoDurationSec: r.durationSec,
        resolution: r.resolution,
        generatedAt: now,
        videoPromptEn,
        videoPromptJa: userDirection,
        scene: finalScene,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
