import { NextRequest, NextResponse } from "next/server";
import { UkiyoeTopicSchema } from "@rekishi/shared";
import { createJob, listJobs } from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

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

  const parsed = UkiyoeTopicSchema.safeParse(body);
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
