import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { finalVideoPath } from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  let buf: Buffer;
  try {
    buf = await readFile(finalVideoPath(jobId));
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
    },
  });
}
