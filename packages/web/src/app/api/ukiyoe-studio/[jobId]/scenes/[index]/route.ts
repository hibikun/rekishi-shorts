import { NextRequest, NextResponse } from "next/server";
import { UkiyoeSceneSpecSchema } from "@rekishi/shared";
import {
  loadJob,
  readScenePlanJson,
  saveJob,
  writeScenePlanJson,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, index: rawIndex } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  const sceneIndex = Number.parseInt(rawIndex, 10);

  if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
    return NextResponse.json(
      { ok: false, error: `invalid scene index: ${rawIndex}` },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = UkiyoeSceneSpecSchema.safeParse(
    (body as { scene?: unknown })?.scene,
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join(", "),
      },
      { status: 400 },
    );
  }

  if (parsed.data.index !== sceneIndex) {
    return NextResponse.json(
      { ok: false, error: "scene.index と URL の index が一致しません" },
      { status: 400 },
    );
  }

  try {
    const plan = await readScenePlanJson(jobId);
    if (!plan) {
      return NextResponse.json(
        { ok: false, error: "scene-plan.json が見つかりません" },
        { status: 404 },
      );
    }
    const idx = plan.scenes.findIndex((s) => s.index === sceneIndex);
    if (idx < 0) {
      return NextResponse.json(
        { ok: false, error: `scene ${sceneIndex} が plan に存在しません` },
        { status: 404 },
      );
    }
    plan.scenes[idx] = parsed.data;
    await writeScenePlanJson(jobId, plan);

    const job = await loadJob(jobId);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        scenes: {
          ...job.steps.scenes,
          status: "done" as const,
          updatedAt: now,
          error: undefined,
        },
      },
    };
    await saveJob(next);
    return NextResponse.json({ ok: true, scene: parsed.data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
