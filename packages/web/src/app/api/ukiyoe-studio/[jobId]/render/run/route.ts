import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  finalVideoPath,
  loadJob,
  readScenePlanJson,
  readScriptJson,
  saveJob,
  ukiyoePlanJsonPath,
} from "@/lib/ukiyoe-studio-job";
import { repoRoot } from "@/lib/plan";

export const runtime = "nodejs";
export const maxDuration = 800;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function runCli(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: repoRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      output += s;
      console.log(s.trimEnd());
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      output += s;
      console.error(s.trimEnd());
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

export async function POST(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);

  let job;
  try {
    job = await loadJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `job not found: ${msg}` },
      { status: 404 },
    );
  }

  if (job.steps.tts.status !== "done") {
    return NextResponse.json(
      { ok: false, error: "TTS ステップを先に完了してください" },
      { status: 400 },
    );
  }
  if (job.steps.videos.status !== "done") {
    return NextResponse.json(
      { ok: false, error: "Videos ステップを先に完了してください" },
      { status: 400 },
    );
  }

  const script = await readScriptJson(jobId);
  const plan = await readScenePlanJson(jobId);
  if (!script || !plan) {
    return NextResponse.json(
      { ok: false, error: "script.json / scene-plan.json が見つかりません" },
      { status: 400 },
    );
  }

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      render: {
        ...job.steps.render,
        status: "in-progress",
        updatedAt: startNow,
        error: undefined,
      },
    },
  });

  try {
    // pipeline の ukiyoe-generate を --no-images --no-videos --no-tts で実行
    // → caption alignment + plan build + Remotion レンダリング のみ動く
    const cliArgs = [
      "--filter",
      "@rekishi/pipeline",
      "exec",
      "tsx",
      "src/cli.ts",
      "ukiyoe-generate",
      "--topic",
      script.topic,
      "--scenes",
      String(script.targetSceneCount),
      "--job-id",
      jobId,
      "--no-images",
      "--no-videos",
      "--no-tts",
    ];

    const { code, output } = await runCli(cliArgs);
    if (code !== 0) {
      throw new Error(
        `ukiyoe-generate (render-only) failed (exit=${code}). 末尾 1KB:\n${output.slice(-1024)}`,
      );
    }

    const outPath = path.join(
      repoRoot(),
      "data",
      "ukiyoe",
      "videos",
      `${jobId}.mp4`,
    );
    if (!(await fileExists(outPath))) {
      throw new Error(`レンダリング後 mp4 が見当たりません: ${outPath}`);
    }
    if (!(await fileExists(ukiyoePlanJsonPath(jobId)))) {
      throw new Error("ukiyoe-plan.json が生成されていません");
    }

    // 完成 mp4 のパスを更新
    const finalPath = finalVideoPath(jobId);
    const next = {
      ...job,
      steps: {
        ...job.steps,
        render: {
          ...job.steps.render,
          status: "done" as const,
          updatedAt: new Date().toISOString(),
          outputPath: finalPath,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({
      ok: true,
      job: next,
      outputPath: finalPath,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed = await loadJob(jobId);
    await saveJob({
      ...failed,
      steps: {
        ...failed.steps,
        render: {
          ...failed.steps.render,
          status: "error",
          updatedAt: new Date().toISOString(),
          error: msg,
        },
      },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
