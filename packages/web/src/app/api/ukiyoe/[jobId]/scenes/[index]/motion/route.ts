import { NextRequest, NextResponse } from "next/server";
import { MotionGrammarSchema, type MotionGrammar } from "@rekishi/shared";
import { loadUkiyoePlan, saveUkiyoePlan } from "@/lib/ukiyoe-plan";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ jobId: string; index: string }>;
}

interface PostBody {
  motion?: MotionGrammar | null;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { jobId, index } = await context.params;
  const sceneIndex = Number(index);
  if (!Number.isInteger(sceneIndex)) {
    return NextResponse.json(
      { ok: false, error: `invalid scene index: ${index}` },
      { status: 400 },
    );
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const plan = await loadUkiyoePlan(jobId);
  const scene = plan.scenes.find((s) => s.index === sceneIndex);
  if (!scene) {
    return NextResponse.json(
      { ok: false, error: `scene ${sceneIndex} not found in ${jobId}` },
      { status: 404 },
    );
  }

  if (body.motion === null || body.motion === undefined) {
    delete scene.motion;
  } else {
    scene.motion = MotionGrammarSchema.parse(body.motion);
  }
  await saveUkiyoePlan(jobId, plan);

  return NextResponse.json({
    ok: true,
    sceneIndex,
    motion: scene.motion ?? null,
  });
}
