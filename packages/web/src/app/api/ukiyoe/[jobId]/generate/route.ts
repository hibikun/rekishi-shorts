import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  generateUkiyoeVideos,
  SEEDANCE_MODEL,
  type UkiyoeSceneVideoInput,
  type UkiyoeActionTag,
} from "@rekishi/pipeline/ukiyoe-video-generator";
import { loadUkiyoePlan, ukiyoeJobRoot } from "@/lib/ukiyoe-plan";

export const runtime = "nodejs";
// Seedance 呼び出しは長時間かかる
export const maxDuration = 600;

interface SceneOverride {
  index: number;
  videoPrompt?: string;
  cameraFixed?: boolean;
}

interface PostBody {
  /** dry-run なら fal.ai 呼ばずに prompt/params を返すだけ。default true (安全側) */
  dryRun?: boolean;
  /** 生成解像度。default 720p */
  resolution?: "480p" | "720p";
  /** 既存 mp4 を上書き再生成するか。default false (既存は skip) */
  force?: boolean;
  /** UI 側で編集された prompt / cameraFixed の override。 index ごと */
  scenes?: SceneOverride[];
}

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { jobId } = await context.params;

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // body 無し → 既定値
  }

  // 安全側: 明示的に dryRun: false が指定されない限り dry-run。
  const dryRun = body.dryRun !== false;
  const resolution = body.resolution ?? "720p";

  const logs: string[] = [];
  const onProgress = (msg: string) => {
    logs.push(msg);
    console.log(msg);
  };

  try {
    const plan = await loadUkiyoePlan(jobId);

    const overrides = new Map<number, SceneOverride>();
    for (const o of body.scenes ?? []) overrides.set(o.index, o);

    const root = ukiyoeJobRoot(jobId);
    const videosDir = path.join(root, "videos");

    const sceneInputs: UkiyoeSceneVideoInput[] = plan.scenes.map((s) => {
      const o = overrides.get(s.index);
      return {
        index: s.index,
        imagePath: s.imagePath,
        scenePrompt: o?.videoPrompt ?? s.videoPrompt,
        actionTag: s.actionTag as UkiyoeActionTag,
        cameraFixed: o?.cameraFixed ?? s.cameraFixed,
        duration: 5,
      };
    });

    const startedAt = Date.now();
    const sceneResults = await generateUkiyoeVideos(sceneInputs, videosDir, {
      dryRun,
      resolution,
      skipExisting: !body.force,
      onProgress,
    });
    const totalElapsedSec = (Date.now() - startedAt) / 1000;
    const totalEstimatedCostUsd = sceneResults.reduce(
      (sum, r) => sum + r.estimatedCostUsd,
      0,
    );

    return NextResponse.json({
      ok: true,
      result: {
        jobId,
        model: SEEDANCE_MODEL,
        dryRun,
        resolution,
        totalEstimatedCostUsd,
        totalElapsedSec,
        scenes: sceneResults.map((r) => ({
          index: r.index,
          status: r.status,
          prompt: r.prompt,
          duration: r.duration,
          estimatedCostUsd: r.estimatedCostUsd,
          videoPath: r.videoPath,
          error: r.error,
        })),
      },
      logs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        logs,
      },
      { status: 500 },
    );
  }
}
