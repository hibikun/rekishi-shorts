import { NextRequest, NextResponse } from "next/server";
import { SelfMotivationScenesSchema } from "@rekishi/shared";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  loadJob,
  saveJob,
  writeScenesJson,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

/**
 * scenes 配列を全置換する。エディタからの narration / motionPresetId 編集や
 * シーン削除を反映するために使う（reorder は対象外）。
 */
export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  const parsed = SelfMotivationScenesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join(", "),
      },
      { status: 400 },
    );
  }
  try {
    const job = await loadJob(jobId);
    await writeScenesJson(jobId, parsed.data.scenes);
    return NextResponse.json({ ok: true, job, scenes: parsed.data.scenes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
