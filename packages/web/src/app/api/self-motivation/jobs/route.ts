import { NextRequest, NextResponse } from "next/server";
import { TopicSchema } from "@rekishi/shared";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  createJob,
  listJobs,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";

setChannel(SELF_MOTIVATION_CHANNEL);

export async function GET(): Promise<Response> {
  try {
    const jobs = await listJobs();
    return NextResponse.json({ ok: true, jobs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  // 自己啓発チャンネルでは subject default を "自己啓発" にする
  const withDefaults = {
    ...(typeof body === "object" && body !== null ? body : {}),
    subject:
      (body as { subject?: string })?.subject ?? "自己啓発",
    target: (body as { target?: string })?.target ?? "汎用",
    format: (body as { format?: string })?.format ?? "single",
  };
  const parsed = TopicSchema.safeParse(withDefaults);
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
    const job = await createJob(parsed.data);
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
