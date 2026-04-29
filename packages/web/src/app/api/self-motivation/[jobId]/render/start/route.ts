import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  loadJob,
  renderDir,
  renderStatusPath,
  saveJob,
} from "@rekishi/pipeline/self-motivation";

export const runtime = "nodejs";

setChannel(SELF_MOTIVATION_CHANNEL);

interface Ctx {
  params: Promise<{ jobId: string }>;
}

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  try {
    const job = await loadJob(jobId);

    // 進行中なら 409
    if (job.steps.render.status === "in-progress") {
      return NextResponse.json(
        { ok: false, error: "既にレンダリング中です" },
        { status: 409 },
      );
    }

    // 初期 status を書く
    const startedAt = new Date().toISOString();
    await mkdir(renderDir(jobId), { recursive: true });
    await writeFile(
      renderStatusPath(jobId),
      `${JSON.stringify({ state: "running", progress: 0, startedAt, updatedAt: startedAt }, null, 2)}\n`,
      "utf-8",
    );

    // job.json も in-progress に
    const next = {
      ...job,
      steps: {
        ...job.steps,
        render: {
          ...job.steps.render,
          status: "in-progress" as const,
          progress: 0,
          updatedAt: startedAt,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    // 子プロセスを spawn（detached + unref で Next.js プロセスから切り離す）
    const cliPath = path.join(
      REPO_ROOT,
      "packages",
      "pipeline",
      "src",
      "self-motivation-render-cli.ts",
    );
    const child = spawn("pnpm", ["tsx", cliPath, jobId], {
      cwd: REPO_ROOT,
      stdio: "ignore",
      detached: true,
      env: process.env,
    });
    child.on("error", (err) => {
      console.error("[self-motivation render-cli spawn error]", err);
    });
    child.unref();

    return NextResponse.json({ ok: true, job: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
