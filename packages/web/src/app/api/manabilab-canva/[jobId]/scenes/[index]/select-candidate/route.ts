import { NextRequest, NextResponse } from "next/server";
import type { ManabilabCanvaJob, ManabilabCanvaScene } from "@rekishi/shared";
import {
  loadJob,
  readScenesJson,
  saveJob,
  writeScenesJson,
} from "@/lib/canva-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
}

interface PostBody {
  /** 選択するバリアント番号（imageCandidates[].variantIndex に一致するもの） */
  variantIndex?: unknown;
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
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const variantIndex = Number(body.variantIndex);
  if (!Number.isInteger(variantIndex) || variantIndex < 0) {
    return NextResponse.json(
      { ok: false, error: "variantIndex は 0 以上の整数で指定してください" },
      { status: 400 },
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

  const candidate = (target.imageCandidates ?? []).find(
    (c) => c.variantIndex === variantIndex,
  );
  if (!candidate) {
    return NextResponse.json(
      {
        ok: false,
        error: `variantIndex ${variantIndex} の候補が見つかりません`,
      },
      { status: 404 },
    );
  }
  if (!candidate.imagePath) {
    return NextResponse.json(
      { ok: false, error: "選択された候補に画像がありません（再生成してください）" },
      { status: 400 },
    );
  }

  const updatedScene: ManabilabCanvaScene = {
    ...target,
    selectedCandidateIndex: variantIndex,
    imagePath: candidate.imagePath,
    imagePromptEn: candidate.promptEn,
    imageGeneratedAt: candidate.generatedAt,
  };
  const nextScenes = scenes.map((s) =>
    s.index === sceneIndex ? updatedScene : s,
  );
  await writeScenesJson(jobId, nextScenes);

  // 全シーンが選択済みになったら images ステップを done に
  const allSelected = nextScenes.every((s) => !!s.imagePath);
  let job: ManabilabCanvaJob | null = null;
  try {
    job = await loadJob(jobId);
  } catch {
    job = null;
  }
  if (job) {
    const now = new Date().toISOString();
    const desiredStatus: "done" | "in-progress" = allSelected
      ? "done"
      : "in-progress";
    if (job.steps.images.status !== desiredStatus) {
      const nextJob: ManabilabCanvaJob = {
        ...job,
        steps: {
          ...job.steps,
          images: {
            ...job.steps.images,
            status: desiredStatus,
            updatedAt: now,
            error: undefined,
          },
        },
      };
      await saveJob(nextJob);
      job = nextJob;
    }
  }

  return NextResponse.json({
    ok: true,
    sceneIndex,
    selectedCandidateIndex: variantIndex,
    scene: updatedScene,
    job,
  });
}
