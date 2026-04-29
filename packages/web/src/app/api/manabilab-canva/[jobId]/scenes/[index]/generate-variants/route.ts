import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { stat } from "node:fs/promises";
import {
  DEFAULT_VARIANT_COUNT,
  generateImagePromptForScene,
} from "@rekishi/pipeline";
import { generateImage } from "@rekishi/pipeline/image-generator";
import { setChannel } from "@rekishi/shared/channel";
import type { ImageCandidate, ManabilabCanvaScene } from "@rekishi/shared";
import {
  CANVA_CHANNEL_SLUG,
  jobDir,
  loadJob,
  readScenesJson,
  writeScenesJson,
} from "@/lib/canva-job";

export const runtime = "nodejs";
// 3 variants × (prompt + image) を並列実行。Nano Banana が遅い時に備えて余裕を持たせる
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
}

interface PostBody {
  /** ユーザーの日本語ポーズ指示（任意）。未指定なら scene.imagePromptJa を使う */
  userDirectionJa?: string;
  /** 生成する案数。default 3 */
  variantCount?: number;
  /** 既に candidates が埋まっていても全案上書きする。default true（このエンドポイントは「3 案を作る」が責務） */
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

function variantImageRel(jobId: string, sceneIndex: number, variantIndex: number): string {
  const fileName = `scene-${String(sceneIndex).padStart(2, "0")}-v${variantIndex}.png`;
  return path.join("jobs", jobId, "images", fileName);
}

function variantImageAbs(jobId: string, sceneIndex: number, variantIndex: number): string {
  const fileName = `scene-${String(sceneIndex).padStart(2, "0")}-v${variantIndex}.png`;
  return path.join(jobDir(jobId), "images", fileName);
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
  const variantCount = body.variantCount ?? DEFAULT_VARIANT_COUNT;

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

  setChannel(CANVA_CHANNEL_SLUG);

  // ユーザー指示を保存（imagePromptJa は 3 案共通の「種」）
  const sceneWithDirection: ManabilabCanvaScene = {
    ...target,
    imagePromptJa: userDirectionJa,
  };

  // 1) 3 つのプロンプトを並列生成
  const promptPromises = Array.from({ length: variantCount }, (_, vi) =>
    generateImagePromptForScene(sceneWithDirection, job.topic, {
      variantIndex: vi,
      variantCount,
      userDirection: userDirectionJa || undefined,
    }),
  );
  const promptResults = await Promise.allSettled(promptPromises);

  // 2) 各バリアントについて、プロンプトが取れたものは画像生成。失敗は記録だけ。
  const candidates: ImageCandidate[] = [];
  const errors: { variantIndex: number; error: string }[] = [];

  await Promise.all(
    promptResults.map(async (pr, vi) => {
      if (pr.status === "rejected") {
        errors.push({
          variantIndex: vi,
          error:
            pr.reason instanceof Error ? pr.reason.message : String(pr.reason),
        });
        return;
      }
      const promptEn = pr.value.imagePromptEn;
      const poseSummaryJa = pr.value.poseSummaryJa;

      const destAbs = variantImageAbs(jobId, sceneIndex, vi);
      const relFromChannel = variantImageRel(jobId, sceneIndex, vi);
      try {
        await generateImage(promptEn, destAbs, {
          referenceImages: [refPath],
          appendAspectSuffix: false,
        });
        candidates.push({
          variantIndex: vi,
          promptEn,
          poseSummaryJa,
          imagePath: relFromChannel,
          generatedAt: new Date().toISOString(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ variantIndex: vi, error: msg });
        // 画像はないが、プロンプトだけでも残しておく（再生成のヒントになる）
        candidates.push({
          variantIndex: vi,
          promptEn,
          poseSummaryJa,
          imagePath: undefined,
          generatedAt: undefined,
        });
      }
    }),
  );

  candidates.sort((a, b) => a.variantIndex - b.variantIndex);

  // 3) scenes.json を最新読み込み → 該当 scene を更新（並列レース対策で書く直前に再読み込み）
  const latestScenes = (await readScenesJson(jobId)) ?? scenes;
  const updatedScene: ManabilabCanvaScene = {
    ...sceneWithDirection,
    imageCandidates: candidates,
    // 「3 案再生成」では選択をリセット。後段は selectedCandidateIndex が定まるまで再生不能
    selectedCandidateIndex: undefined,
    imagePath: undefined,
    imagePromptEn: "",
    imageGeneratedAt: undefined,
  };
  const nextScenes = latestScenes.map((s) =>
    s.index === sceneIndex ? updatedScene : s,
  );
  await writeScenesJson(jobId, nextScenes);

  return NextResponse.json({
    ok: errors.length === 0,
    sceneIndex,
    candidates,
    errors,
  });
}
