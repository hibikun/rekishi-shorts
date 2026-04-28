import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ukiyoeJobRoot } from "@/lib/ukiyoe-plan";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ jobId: string; kind: string; file: string }>;
}

const KIND_ALLOW = new Set(["images", "videos"]);
const FILE_PATTERN = /^scene-\d{2}\.(png|jpg|jpeg|mp4)$/;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
};

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const { jobId, kind, file } = await ctx.params;

  if (!KIND_ALLOW.has(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  if (!FILE_PATTERN.test(file)) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 });
  }

  let root: string;
  try {
    root = ukiyoeJobRoot(jobId);
  } catch {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }

  const abs = path.join(root, kind, file);
  // ukiyoeJobRoot で jobId は検証済み。kind/file も regex で固定なので
  // 上で組んだ abs はジョブディレクトリ配下に閉じている。

  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ext = path.extname(file).slice(1).toLowerCase();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
