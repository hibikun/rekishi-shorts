import { NextRequest, NextResponse } from "next/server";
import { generateManabilabVideos } from "@rekishi/pipeline/manabilab-video-generator";

export const runtime = "nodejs";
// Seedance 呼び出しは長時間かかるので Vercel/Node 既定の 10〜30s 制限を緩める
export const maxDuration = 600;

interface PostBody {
  /** dry-run なら fal.ai 呼ばずに prompt/params を返すだけ。default true (安全側) */
  dryRun?: boolean;
  /** 生成解像度。default 720p */
  resolution?: "480p" | "720p";
  /** 既存 mp4 を上書き再生成するか。default false (既存は skip) */
  force?: boolean;
  /** 指定シーンだけ実行 (1始まり)。空/未指定なら全シーン */
  sceneIndices?: number[];
}

interface RouteContext {
  params: Promise<{ planId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { planId } = await context.params;

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // body 無し or 壊れてる → 既定値で実行
  }

  // 安全側: 明示的に dryRun: false が指定されない限り dry-run。
  // 本実行は UI 側で 2 段階確認を経て dryRun:false を送る。
  const dryRun = body.dryRun !== false;

  const logs: string[] = [];
  const onProgress = (msg: string) => {
    logs.push(msg);
    console.log(msg);
  };

  try {
    const result = await generateManabilabVideos({
      planId,
      dryRun,
      resolution: body.resolution ?? "720p",
      skipExisting: !body.force,
      sceneIndices: body.sceneIndices,
      onProgress,
    });

    return NextResponse.json({
      ok: true,
      result,
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
