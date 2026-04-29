import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadJob, saveJob } from "@/lib/canva-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

const SettingsBodySchema = z.object({
  voiceName: z.string().min(1).optional(),
  stylePromptOverride: z.string().optional(),
  ttsModel: z.string().optional(),
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

  const parsed = SettingsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  try {
    const job = await loadJob(jobId);
    const now = new Date().toISOString();
    const next = {
      ...job,
      steps: {
        ...job.steps,
        tts: {
          ...job.steps.tts,
          ...(parsed.data.voiceName !== undefined
            ? { voiceName: parsed.data.voiceName }
            : {}),
          ...(parsed.data.stylePromptOverride !== undefined
            ? {
                stylePromptOverride:
                  parsed.data.stylePromptOverride.trim() || undefined,
              }
            : {}),
          ...(parsed.data.ttsModel !== undefined
            ? { ttsModel: parsed.data.ttsModel.trim() || undefined }
            : {}),
          updatedAt: now,
        },
      },
    };
    await saveJob(next);
    return NextResponse.json({ ok: true, job: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
