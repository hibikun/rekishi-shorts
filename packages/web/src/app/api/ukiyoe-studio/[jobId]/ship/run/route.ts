import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile } from "node:fs/promises";
import {
  YouTubeMetadataSchema,
  appendUploadLog,
  draftMdToMetadata,
  loadUkiyoePlanAsRenderPlan,
  uploadToYouTube,
  type YouTubeMetadata,
} from "@rekishi/publisher";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  loadJob,
  metaDraftPath,
  metaJsonPath,
  saveJob,
  uploadJsonPath,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 800;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

interface PostBody {
  privacy?: "public" | "unlisted" | "private";
  publishAt?: string | null;
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

  if (job.steps.render.status !== "done" || !job.steps.render.outputPath) {
    return NextResponse.json(
      { ok: false, error: "Render が完了していません" },
      { status: 400 },
    );
  }
  if (!job.steps.ship.metaGenerated) {
    return NextResponse.json(
      { ok: false, error: "先に meta を生成してください" },
      { status: 400 },
    );
  }

  let publishAtIso: string | undefined;
  if (body.publishAt) {
    const dt = new Date(body.publishAt);
    if (Number.isNaN(dt.getTime())) {
      return NextResponse.json(
        { ok: false, error: `publishAt が不正です: ${body.publishAt}` },
        { status: 400 },
      );
    }
    if (dt.getTime() <= Date.now()) {
      return NextResponse.json(
        { ok: false, error: `publishAt は未来時刻である必要があります: ${dt.toISOString()}` },
        { status: 400 },
      );
    }
    publishAtIso = dt.toISOString();
  }

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      ship: {
        ...job.steps.ship,
        status: "in-progress",
        updatedAt: startNow,
        error: undefined,
      },
    },
  });

  try {
    setChannel(UKIYOE_CHANNEL_SLUG);

    // meta-draft.md を最新にする
    const draftMd = await readFile(metaDraftPath(jobId), "utf-8");
    const original = JSON.parse(
      await readFile(metaJsonPath(jobId), "utf-8"),
    ) as YouTubeMetadata;
    const editedMeta = draftMdToMetadata(draftMd, original);

    const overrides: Partial<YouTubeMetadata> = {};
    if (body.privacy) overrides.privacyStatus = body.privacy;
    if (publishAtIso) overrides.publishAt = publishAtIso;
    const finalMetadata =
      Object.keys(overrides).length > 0
        ? YouTubeMetadataSchema.parse({ ...editedMeta, ...overrides })
        : editedMeta;

    const result = await uploadToYouTube({
      videoPath: job.steps.render.outputPath,
      metadata: finalMetadata,
    });

    const uploadInfo = {
      ...result,
      privacy: finalMetadata.privacyStatus,
      title: finalMetadata.title,
    };
    await writeFile(
      uploadJsonPath(jobId),
      JSON.stringify(uploadInfo, null, 2),
      "utf-8",
    );
    await appendUploadLog({
      jobId,
      videoId: result.videoId,
      url: result.url,
      uploadedAt: result.uploadedAt,
      privacy: finalMetadata.privacyStatus,
      title: finalMetadata.title,
    });

    const next = {
      ...job,
      steps: {
        ...job.steps,
        ship: {
          ...job.steps.ship,
          status: "done" as const,
          updatedAt: new Date().toISOString(),
          youtubeVideoId: result.videoId,
          youtubeUrl: result.url,
          privacy: finalMetadata.privacyStatus,
          publishedAt: result.uploadedAt,
          metaGenerated: true,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: true,
      job: next,
      result: uploadInfo,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed = await loadJob(jobId);
    await saveJob({
      ...failed,
      steps: {
        ...failed.steps,
        ship: {
          ...failed.steps.ship,
          status: "error",
          updatedAt: new Date().toISOString(),
          error: msg,
        },
      },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
