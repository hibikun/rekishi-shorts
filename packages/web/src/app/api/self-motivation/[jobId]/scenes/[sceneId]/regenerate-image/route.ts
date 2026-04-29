import { NextRequest, NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  generateImagePromptForScene,
  generateLongformImage,
  imagesDir,
  loadJob,
  readScenesJson,
  readScriptJson,
  relFromChannelRoot,
  sceneImagePath,
  writeScenesJson,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";
export const maxDuration = 600;

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string; sceneId: string }>;
}

interface PostBody {
  userDirection?: string;
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

    await mkdir(imagesDir(jobId), { recursive: true });

    const promptResult = await generateImagePromptForScene(
      target,
      script,
      job.topic,
      userDirection,
    );
    const dest = sceneImagePath(jobId, sceneId);
    await generateLongformImage(promptResult.imagePromptEn, dest);
    const now = new Date().toISOString();
    const updated = scenes.map((s) =>
      s.sceneId === sceneId
        ? {
            ...s,
            imagePromptJa: userDirection,
            imagePromptEn: promptResult.imagePromptEn,
            imagePath: relFromChannelRoot(dest),
            imageGeneratedAt: now,
          }
        : s,
    );
    await writeScenesJson(jobId, updated);

    const imageUrl = `/${SELF_MOTIVATION_CHANNEL}/${relFromChannelRoot(dest)}?t=${Date.now()}`;
    const updatedScene = updated.find((s) => s.sceneId === sceneId);
    return NextResponse.json({
      ok: true,
      sceneId,
      imageUrl,
      generatedAt: now,
      scene: updatedScene,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
