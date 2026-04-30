import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import {
  metaDraftPath,
  readMetaDraft,
  writeMetaDraft,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    const md = await readMetaDraft(jobId);
    return NextResponse.json({ ok: true, draftMd: md });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

interface PatchBody {
  draftMd?: string;
}

export async function PATCH(
  request: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: PatchBody = {};
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.draftMd !== "string") {
    return NextResponse.json(
      { ok: false, error: "draftMd is required" },
      { status: 400 },
    );
  }

  try {
    await writeMetaDraft(jobId, body.draftMd);
    // 検証として読み戻す
    await readFile(metaDraftPath(jobId), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
