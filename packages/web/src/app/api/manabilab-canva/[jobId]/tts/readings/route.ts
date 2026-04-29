import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadJob, readScriptJson, writeScriptJson } from "@/lib/canva-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

const ReadingsBodySchema = z.object({
  readings: z.array(
    z.object({
      term: z.string().min(1),
      reading: z.string().min(1),
    }),
  ),
});

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = ReadingsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  try {
    await loadJob(jobId);
    const script = await readScriptJson(jobId);
    if (!script) {
      return NextResponse.json(
        { ok: false, error: "script.json が読めません。Script ステップを完了してください" },
        { status: 400 },
      );
    }

    const next = { ...script, readings: parsed.data.readings };
    await writeScriptJson(jobId, next);
    return NextResponse.json({ ok: true, readings: next.readings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
