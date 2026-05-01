import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { narrationWavPath } from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  let buf: Buffer;
  try {
    buf = await readFile(narrationWavPath(jobId));
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    },
  });
}
