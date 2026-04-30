import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile } from "node:fs/promises";
import {
  generateYouTubeMetadata,
  loadUkiyoePlanAsRenderPlan,
  metadataToDraftMd,
} from "@rekishi/publisher";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  loadJob,
  metaDraftPath,
  metaJsonPath,
  saveJob,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PostBody {
  /** 既存 meta があっても再生成する。default false */
  regenerate?: boolean;
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // OK
  }

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

  if (job.steps.render.status !== "done") {
    return NextResponse.json(
      { ok: false, error: "Render ステップを先に完了してください" },
      { status: 400 },
    );
  }

  try {
    setChannel(UKIYOE_CHANNEL_SLUG);

    // 既存の meta-draft.md があり regenerate でなければ流用
    let draftMd: string | null = null;
    if (!body.regenerate) {
      try {
        draftMd = await readFile(metaDraftPath(jobId), "utf-8");
      } catch {
        draftMd = null;
      }
    }

    if (!draftMd) {
      const plan = await loadUkiyoePlanAsRenderPlan(jobId);
      const result = await generateYouTubeMetadata(plan);
      await writeFile(
        metaJsonPath(jobId),
        JSON.stringify(result.metadata, null, 2),
        "utf-8",
      );
      draftMd = metadataToDraftMd(result.metadata, { jobId });
      await writeFile(metaDraftPath(jobId), draftMd, "utf-8");
    }

    const next = {
      ...job,
      steps: {
        ...job.steps,
        ship: {
          ...job.steps.ship,
          metaGenerated: true,
          updatedAt: new Date().toISOString(),
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({ ok: true, job: next, draftMd });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
