import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  characterReferenceDir,
  characterReferencePath,
  findCharacterReferenceFile,
  loadJob,
  relFromChannelRoot,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

const ALLOWED_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

function extFromMime(mime: string): string | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function buildUrl(absPath: string): string {
  const rel = relFromChannelRoot(absPath);
  return `/${SELF_MOTIVATION_CHANNEL}/${rel}?t=${Date.now()}`;
}

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    await loadJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
  }
  const file = await findCharacterReferenceFile(jobId);
  if (!file) return NextResponse.json({ ok: true, exists: false });
  return NextResponse.json({
    ok: true,
    exists: true,
    url: buildUrl(file),
    ext: path.extname(file).slice(1),
  });
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    await loadJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "multipart/form-data の解析に失敗しました" },
      { status: 400 },
    );
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "field 'file' が必要です" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `ファイルサイズが大きすぎます (${file.size} bytes > 10MB)` },
      { status: 400 },
    );
  }

  let ext = extFromMime(file.type);
  if (!ext) {
    const fromName = path.extname(file.name).toLowerCase().slice(1);
    if (ALLOWED_EXTS.has(fromName)) ext = fromName === "jpeg" ? "jpg" : fromName;
  }
  if (!ext) {
    return NextResponse.json(
      {
        ok: false,
        error: `対応していない画像形式です (mime=${file.type}, name=${file.name})`,
      },
      { status: 400 },
    );
  }

  await mkdir(characterReferenceDir(jobId), { recursive: true });

  // 既存のキャラ画像（拡張子違いも含む）は削除
  const existing = await findCharacterReferenceFile(jobId);
  if (existing) {
    try {
      await unlink(existing);
    } catch {
      // ignore
    }
  }

  const dest = characterReferencePath(jobId, ext);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(dest, buf);

  return NextResponse.json({
    ok: true,
    exists: true,
    url: buildUrl(dest),
    ext,
    bytes: buf.length,
  });
}

export async function DELETE(
  _request: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  try {
    await loadJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
  }
  const existing = await findCharacterReferenceFile(jobId);
  if (!existing) return NextResponse.json({ ok: true, exists: false });
  try {
    await unlink(existing);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true, exists: false });
}
