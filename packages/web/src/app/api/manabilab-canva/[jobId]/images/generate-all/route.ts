import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { stat } from "node:fs/promises";
import { generateImagePromptForScene } from "@rekishi/pipeline";
import { generateImage } from "@rekishi/pipeline/image-generator";
import { setChannel } from "@rekishi/shared/channel";
import {
  CANVA_CHANNEL_SLUG,
  jobDir,
  loadJob,
  readScenesJson,
  saveJob,
  writeScenesJson,
} from "@/lib/canva-job";
import type { ManabilabCanvaScene } from "@rekishi/shared";

export const runtime = "nodejs";
// 6 シーン × (プロンプト生成 + 画像生成) で数分かかる可能性
export const maxDuration = 600;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PostBody {
  /** true なら imagePromptEn が空 or 既存の場合だけ Gemini で再生成。default true */
  generateMissingPrompts?: boolean;
  /** 既存画像も上書きするか。default false (skipExisting) */
  force?: boolean;
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

interface PerSceneResult {
  index: number;
  status: "done" | "skipped" | "error";
  imagePath?: string;
  error?: string;
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // body 無し OK
  }
  const generateMissingPrompts = body.generateMissingPrompts !== false;
  const force = body.force === true;

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

  let scenes = await readScenesJson(jobId);
  if (!scenes) {
    return NextResponse.json(
      { ok: false, error: "scenes.json が読めません" },
      { status: 400 },
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

  // images ステップを in-progress に
  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      images: { ...job.steps.images, status: "in-progress", updatedAt: startNow },
    },
  });

  setChannel(CANVA_CHANNEL_SLUG);
  const results: PerSceneResult[] = [];

  for (const scene of scenes) {
    try {
      let promptEn = scene.imagePromptEn?.trim() ?? "";

      if (!promptEn && generateMissingPrompts) {
        const r = await generateImagePromptForScene(scene, job.topic);
        promptEn = r.imagePromptEn;
        scenes = scenes!.map((s) =>
          s.index === scene.index ? { ...s, imagePromptEn: promptEn } : s,
        );
        await writeScenesJson(jobId, scenes);
      }

      if (!promptEn) {
        results.push({
          index: scene.index,
          status: "error",
          error: "imagePromptEn が空です",
        });
        continue;
      }

      if (scene.imagePath && !force) {
        results.push({
          index: scene.index,
          status: "skipped",
          imagePath: scene.imagePath,
        });
        continue;
      }

      const fileName = `scene-${String(scene.index).padStart(2, "0")}.png`;
      const destAbs = path.join(jobDir(jobId), "images", fileName);
      const relFromChannel = path.join("jobs", jobId, "images", fileName);

      await generateImage(promptEn, destAbs, {
        referenceImages: [refPath],
        appendAspectSuffix: false,
      });

      const now = new Date().toISOString();
      scenes = scenes!.map((s) =>
        s.index === scene.index
          ? { ...s, imagePath: relFromChannel, imageGeneratedAt: now }
          : s,
      );
      await writeScenesJson(jobId, scenes);

      results.push({
        index: scene.index,
        status: "done",
        imagePath: relFromChannel,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ index: scene.index, status: "error", error: msg });
    }
  }

  // images ステップ更新（全 scene に imagePath が付いたら done）
  const allHave = scenes!.every((s: ManabilabCanvaScene) => !!s.imagePath);
  const anyError = results.some((r) => r.status === "error");
  const doneNow = new Date().toISOString();
  const nextJob = {
    ...job,
    steps: {
      ...job.steps,
      images: {
        ...job.steps.images,
        status: (allHave
          ? "done"
          : anyError
          ? "error"
          : "in-progress") as "done" | "error" | "in-progress",
        updatedAt: doneNow,
        error: anyError
          ? results
              .filter((r) => r.status === "error")
              .map((r) => `#${r.index}: ${r.error}`)
              .join(" / ")
          : undefined,
      },
    },
  };
  await saveJob(nextJob);

  return NextResponse.json({
    ok: !anyError,
    job: nextJob,
    scenes,
    results,
  });
}
