import { spawn } from "node:child_process";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// Remotion bundle + render は数分かかる
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ planId: string }>;
}

/**
 * Manabilab plan を Remotion で最終 mp4 に合成する。
 *
 * Next.js webpack が Remotion 内部の binary asset (esbuild 等) を bundle できない
 * 問題を回避するため、subprocess (tsx) で pipeline 内の render-cli を実行する。
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { planId } = await context.params;
  const startedAt = Date.now();

  // repo root を割り出して subprocess を起動
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const tsxBin = path.join(
    repoRoot,
    "packages",
    "pipeline",
    "node_modules",
    ".bin",
    "tsx",
  );
  const cliPath = path.join(
    repoRoot,
    "packages",
    "pipeline",
    "src",
    "manabilab-render-cli.ts",
  );

  return new Promise<Response>((resolve) => {
    const child = spawn(tsxBin, [cliPath, planId], {
      cwd: repoRoot,
      env: { ...process.env },
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let resultJson: unknown = null;
    const progressLines: string[] = [];

    child.stdout.on("data", (buf: Buffer) => {
      const text = buf.toString("utf-8");
      stdoutChunks.push(text);
      // 行ごとに RESULT_JSON / PROGRESS を解釈
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("RESULT_JSON:")) {
          try {
            resultJson = JSON.parse(trimmed.slice("RESULT_JSON:".length).trim());
          } catch {
            /* ignore */
          }
        } else if (trimmed.startsWith("PROGRESS:")) {
          progressLines.push(trimmed);
        }
      }
    });

    child.stderr.on("data", (buf: Buffer) => {
      stderrChunks.push(buf.toString("utf-8"));
    });

    child.on("error", (err) => {
      resolve(
        NextResponse.json(
          {
            ok: false,
            error: `failed to spawn renderer subprocess: ${err.message}`,
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
          },
          { status: 500 },
        ),
      );
    });

    child.on("close", (code) => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      if (code === 0 && resultJson) {
        resolve(
          NextResponse.json({
            ok: true,
            result: resultJson,
            elapsedSec,
            progressLog: progressLines,
          }),
        );
      } else {
        resolve(
          NextResponse.json(
            {
              ok: false,
              error:
                stderrChunks.join("").slice(-2000) ||
                `renderer subprocess exited with code ${code}`,
              elapsedSec,
              stdout: stdoutChunks.join("").slice(-2000),
            },
            { status: 500 },
          ),
        );
      }
    });
  });
}
