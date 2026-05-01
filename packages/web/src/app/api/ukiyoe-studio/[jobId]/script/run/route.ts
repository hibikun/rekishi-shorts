import { NextRequest, NextResponse } from "next/server";
import { generateUkiyoeScript } from "@rekishi/pipeline/ukiyoe-script-generator";
import { setChannel } from "@rekishi/shared/channel";
import {
  UKIYOE_CHANNEL_SLUG,
  loadJob,
  readAllYoutubeTranscripts,
  readResearchMarkdown,
  saveJob,
  writeScriptJson,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

function appendYoutubeResearch(
  researchMd: string,
  youtubeTranscripts: Awaited<ReturnType<typeof readAllYoutubeTranscripts>>,
): string {
  if (youtubeTranscripts.length === 0) return researchMd;
  const blocks = youtubeTranscripts.map(({ ref, markdown }, index) =>
    [
      `### 参考動画 ${index + 1}: ${ref.title || ref.videoId}`,
      `- URL: ${ref.url}`,
      ref.note ? `- メモ: ${ref.note}` : null,
      "",
      markdown.trim(),
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
  );
  return [
    researchMd.trim(),
    "",
    "## 参考 YouTube 動画",
    "以下は Gemini が参考動画を視聴して作成した書き起こしと構成分析。動画内で語られた内容として扱い、史実の確定には通常リサーチの出典も優先して照合すること。",
    "",
    ...blocks,
  ].join("\n");
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

  if (job.steps.research.status !== "done") {
    return NextResponse.json(
      { ok: false, error: "research ステップを先に完了してください" },
      { status: 400 },
    );
  }

  const researchMd = await readResearchMarkdown(jobId);
  if (!researchMd.trim()) {
    return NextResponse.json(
      { ok: false, error: "research.md が空です" },
      { status: 400 },
    );
  }

  const startNow = new Date().toISOString();
  await saveJob({
    ...job,
    steps: {
      ...job.steps,
      script: {
        ...job.steps.script,
        status: "in-progress",
        updatedAt: startNow,
        error: undefined,
      },
    },
  });

  try {
    setChannel(UKIYOE_CHANNEL_SLUG);
    const youtubeTranscripts = await readAllYoutubeTranscripts(jobId);
    const researchWithYoutube = appendYoutubeResearch(
      researchMd,
      youtubeTranscripts,
    );
    const result = await generateUkiyoeScript({
      topic: job.topic.title,
      era: job.topic.era ?? undefined,
      researchMd: researchWithYoutube,
      mode: job.topic.mode,
      targetSceneCount: job.topic.sceneCount,
      targetDurationSec:
        job.topic.sceneCount !== undefined ? job.topic.sceneCount * 5 : undefined,
    });

    const script = {
      ...result.script,
      era: result.script.era ?? null,
    };

    await writeScriptJson(jobId, script);

    const doneNow = new Date().toISOString();
    const latest = await loadJob(jobId);
    const next = {
      ...latest,
      steps: {
        ...latest.steps,
        script: {
          status: "done" as const,
          updatedAt: doneNow,
          model: result.usage.model,
          estimatedDurationSec: result.script.estimatedDurationSec,
          error: undefined,
        },
      },
    };
    await saveJob(next);

    return NextResponse.json({ ok: true, job: next, script });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errNow = new Date().toISOString();
    const failed = await loadJob(jobId);
    await saveJob({
      ...failed,
      steps: {
        ...failed.steps,
        script: {
          ...failed.steps.script,
          status: "error",
          updatedAt: errNow,
          error: msg,
        },
      },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
