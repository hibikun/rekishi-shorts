import { NextRequest, NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  findCharacterReferenceFile,
  generateImagePromptForScene,
  generateLongformImage,
  imagesDir,
  loadJob,
  readScenesJson,
  readScriptJson,
  relFromChannelRoot,
  saveJob,
  sceneImagePath,
  writeScenesJson,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";
export const maxDuration = 900; // 15 min — 100+ シーンで時間がかかる

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

/**
 * 全シーンの画像をまとめて生成する。imagePath が既に存在するシーンはスキップ。
 * 失敗したシーンは collected error に記録するが、他のシーンは続ける。
 */
export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

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

    await mkdir(imagesDir(jobId), { recursive: true });

    const characterRef = await findCharacterReferenceFile(jobId);
    const referenceImages = characterRef ? [characterRef] : undefined;

    const errors: Array<{ sceneId: string; error: string }> = [];
    let updated = [...scenes];
    let processedCount = 0;

    for (const scene of scenes) {
      if (scene.imagePath) {
        // 既に生成済みはスキップ
        continue;
      }
      try {
        const promptResult = await generateImagePromptForScene(
          scene,
          script,
          job.topic,
          "",
          !!characterRef,
        );
        const dest = sceneImagePath(jobId, scene.sceneId);
        await generateLongformImage(promptResult.imagePromptEn, dest, {
          referenceImages,
        });
        const now = new Date().toISOString();
        updated = updated.map((s) =>
          s.sceneId === scene.sceneId
            ? {
                ...s,
                imagePromptEn: promptResult.imagePromptEn,
                imagePath: relFromChannelRoot(dest),
                imageGeneratedAt: now,
              }
            : s,
        );
        // 中間状態を逐次保存
        await writeScenesJson(jobId, updated);
        processedCount += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ sceneId: scene.sceneId, error: msg });
      }
    }

    const allDone = updated.every((s) => !!s.imagePath);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        images: {
          ...job.steps.images,
          status: (allDone ? "done" : errors.length > 0 ? "error" : "pending") as
            | "done"
            | "error"
            | "pending",
          updatedAt: now,
          error: errors.length > 0 ? `${errors.length} 件失敗` : undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: errors.length === 0,
      processedCount,
      errors,
      job: next,
      scenes: updated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
