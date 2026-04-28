import { spawn } from "node:child_process";
import { rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ukiyoeJobRoot } from "@/lib/ukiyoe-plan";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

interface PostBody {
  narration: string;
  hook?: string;
  topic?: string;
  era?: string;
  keyTerms?: string[];
  readings?: Record<string, string>;
  targetSceneCount: number;
  estimatedDurationSec?: number;
}

interface ScriptShape {
  topic: string;
  era?: string | null;
  hook: string;
  narration: string;
  keyTerms: string[];
  readings: Record<string, string>;
  estimatedDurationSec: number;
  targetSceneCount: number;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { jobId } = await context.params;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.narration || typeof body.narration !== "string") {
    return NextResponse.json({ ok: false, error: "narration is required" }, { status: 400 });
  }
  const sceneCount = Number(body.targetSceneCount);
  if (!Number.isInteger(sceneCount) || sceneCount < 2 || sceneCount > 12) {
    return NextResponse.json(
      { ok: false, error: "targetSceneCount must be integer 2..12" },
      { status: 400 },
    );
  }

  let root: string;
  try {
    root = ukiyoeJobRoot(jobId);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid jobId" }, { status: 400 });
  }

  // 既存 script.json を読み、provided フィールドだけ上書きする
  const scriptPath = path.join(root, "script.json");
  let existing: Partial<ScriptShape> = {};
  try {
    const raw = await readFile(scriptPath, "utf-8");
    existing = JSON.parse(raw) as Partial<ScriptShape>;
  } catch {
    // 存在しなければ新規（topic 必須）
  }

  const next: ScriptShape = {
    topic: body.topic ?? existing.topic ?? "",
    era: body.era ?? existing.era ?? null,
    hook: body.hook ?? existing.hook ?? "",
    narration: body.narration,
    keyTerms: body.keyTerms ?? existing.keyTerms ?? [],
    readings: body.readings ?? existing.readings ?? {},
    estimatedDurationSec:
      body.estimatedDurationSec ?? existing.estimatedDurationSec ?? sceneCount * 5,
    targetSceneCount: sceneCount,
  };

  if (!next.topic) {
    return NextResponse.json(
      { ok: false, error: "topic is required (no existing script.json found)" },
      { status: 400 },
    );
  }

  await writeFile(scriptPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");

  // 台本に依存する派生物を全削除（次回 cli が一から作り直す）
  await Promise.all(
    [
      "scene-plan.json",
      "narration.wav",
      "words.json",
      "ukiyoe-plan.json",
    ].map((f) => rm(path.join(root, f), { force: true })),
  );
  await rm(path.join(root, "images"), { recursive: true, force: true });

  // cli を spawn して script-gen 以外を全部やり直す（--no-videos --no-render）
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const tsxBin = path.join(
    repoRoot,
    "packages",
    "pipeline",
    "node_modules",
    ".bin",
    "tsx",
  );
  const cliPath = path.join(repoRoot, "packages", "pipeline", "src", "cli.ts");

  const args = [
    cliPath,
    "ukiyoe-generate",
    "--topic",
    next.topic,
    ...(next.era ? ["--era", next.era] : []),
    "--scenes",
    String(sceneCount),
    "--job-id",
    jobId,
    "--no-videos",
    "--no-render",
  ];

  const startedAt = Date.now();

  return new Promise<Response>((resolve) => {
    const child = spawn(tsxBin, args, {
      cwd: repoRoot,
      env: { ...process.env },
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.on("data", (b: Buffer) => stdoutChunks.push(b.toString("utf-8")));
    child.stderr.on("data", (b: Buffer) => stderrChunks.push(b.toString("utf-8")));

    child.on("error", (err) => {
      resolve(
        NextResponse.json(
          {
            ok: false,
            error: `failed to spawn pipeline: ${err.message}`,
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
          },
          { status: 500 },
        ),
      );
    });

    child.on("close", (code) => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      if (code === 0) {
        resolve(
          NextResponse.json({
            ok: true,
            jobId,
            elapsedSec,
            stdoutTail: stdout.slice(-4000),
          }),
        );
      } else {
        resolve(
          NextResponse.json(
            {
              ok: false,
              error: stderr.slice(-2000) || `pipeline exited with code ${code}`,
              elapsedSec,
              stdoutTail: stdout.slice(-4000),
            },
            { status: 500 },
          ),
        );
      }
    });
  });
}
