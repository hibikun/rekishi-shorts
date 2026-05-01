import { NextRequest, NextResponse } from "next/server";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { UkiyoeJob, UkiyoeSceneSpec } from "@rekishi/shared";
import {
  finalVideoPath,
  imagesDir,
  loadJob,
  readScenePlanJson,
  readScriptJson,
  saveJob,
  ukiyoePlanJsonPath,
  videosDir,
  wordsJsonPath,
  writeScenePlanJson,
  writeScriptJson,
} from "@/lib/ukiyoe-studio-job";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ jobId: string; index: string }>;
}

interface PostBody {
  direction?: "up" | "down";
}

function sceneToken(i: number): string {
  return i.toString().padStart(2, "0");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function tryRm(p: string): Promise<void> {
  try {
    await rm(p);
  } catch {
    // 元から無いだけなら無視
  }
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { jobId: rawJobId, index: rawIndex } = await ctx.params;
  const jobId = decodeURIComponent(rawJobId);
  const removedIndex = Number.parseInt(rawIndex, 10);
  if (!Number.isInteger(removedIndex) || removedIndex < 0) {
    return NextResponse.json(
      { ok: false, error: `invalid scene index: ${rawIndex}` },
      { status: 400 },
    );
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  const direction = body.direction;
  if (direction !== "up" && direction !== "down") {
    return NextResponse.json(
      { ok: false, error: 'direction は "up" または "down" を指定してください' },
      { status: 400 },
    );
  }

  const plan = await readScenePlanJson(jobId);
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: "scene-plan.json が見つかりません" },
      { status: 404 },
    );
  }
  if (plan.scenes.length < 3) {
    return NextResponse.json(
      {
        ok: false,
        error: "シーン数が 3 未満です。マージすると 1 シーンになるため拒否します",
      },
      { status: 400 },
    );
  }

  const idxInArray = plan.scenes.findIndex((s) => s.index === removedIndex);
  if (idxInArray < 0) {
    return NextResponse.json(
      { ok: false, error: `scene ${removedIndex} が plan に存在しません` },
      { status: 404 },
    );
  }
  if (direction === "up" && idxInArray === 0) {
    return NextResponse.json(
      { ok: false, error: "先頭シーンは ↑ に統合できません" },
      { status: 400 },
    );
  }
  if (direction === "down" && idxInArray === plan.scenes.length - 1) {
    return NextResponse.json(
      { ok: false, error: "末尾シーンは ↓ に統合できません" },
      { status: 400 },
    );
  }

  const removed = plan.scenes[idxInArray] as UkiyoeSceneSpec;
  const targetIdxInArray =
    direction === "up" ? idxInArray - 1 : idxInArray + 1;
  const target = plan.scenes[targetIdxInArray] as UkiyoeSceneSpec;

  const mergedNarration =
    direction === "up"
      ? `${target.narration}${removed.narration}`
      : `${removed.narration}${target.narration}`;
  const mergedDurationSec = target.durationSec + removed.durationSec;

  // ① merge 先 scene の narration / durationSec を更新し、対象 scene を配列から除外
  const remainingScenes = plan.scenes
    .filter((s) => s.index !== removedIndex)
    .map<UkiyoeSceneSpec>((s) =>
      s.index === target.index
        ? {
            ...s,
            narration: mergedNarration,
            durationSec: mergedDurationSec,
          }
        : s,
    );

  // ② 残ったシーンの index を 0..N-1 に振り直す
  const reindexed = remainingScenes.map<UkiyoeSceneSpec>((s, i) => ({
    ...s,
    index: i,
  }));
  const totalDurationSec = reindexed.reduce(
    (acc, s) => acc + s.durationSec,
    0,
  );

  await writeScenePlanJson(jobId, {
    ...plan,
    scenes: reindexed,
    totalDurationSec,
  });

  // ③ script.json は narration を変更しない（音声台本は同じ）。targetSceneCount のみ -1
  const script = await readScriptJson(jobId);
  if (script) {
    await writeScriptJson(jobId, {
      ...script,
      targetSceneCount: Math.max(1, script.targetSceneCount - 1),
    });
  }

  // ④ image / video ファイルのリネーム
  //    - 削除した removedIndex のファイルを消し
  //    - removedIndex より後ろの index を 1 つずつ前にリネーム
  //    （旧 plan の index リストを基準に動かすことで、過去 merge による飛び番にも対応）
  const imgDir = imagesDir(jobId);
  const vidDir = videosDir(jobId);
  await tryRm(path.join(imgDir, `scene-${sceneToken(removedIndex)}.png`));
  await tryRm(path.join(vidDir, `scene-${sceneToken(removedIndex)}.mp4`));

  const oldIndices = plan.scenes
    .map((s) => s.index)
    .filter((i) => i > removedIndex)
    .sort((a, b) => a - b);
  for (const oldIdx of oldIndices) {
    const newIdx = oldIdx - 1;
    const oldPng = path.join(imgDir, `scene-${sceneToken(oldIdx)}.png`);
    const newPng = path.join(imgDir, `scene-${sceneToken(newIdx)}.png`);
    if (await fileExists(oldPng)) await rename(oldPng, newPng);
    const oldMp4 = path.join(vidDir, `scene-${sceneToken(oldIdx)}.mp4`);
    const newMp4 = path.join(vidDir, `scene-${sceneToken(newIdx)}.mp4`);
    if (await fileExists(oldMp4)) await rename(oldMp4, newMp4);
  }

  // ⑤ job.steps の generatedScenes を振り直し、merge 先 scene は再生成促すため除外
  const targetNewIndex =
    direction === "up" ? removedIndex - 1 : removedIndex;
  const reindexGenerated = (generated: number[]): number[] => {
    const out: number[] = [];
    for (const x of generated) {
      if (x === removedIndex) continue;
      const newX = x < removedIndex ? x : x - 1;
      if (newX === targetNewIndex) continue;
      out.push(newX);
    }
    return Array.from(new Set(out)).sort((a, b) => a - b);
  };

  // ⑥ 古い alignment / final mp4 / words.json を invalidate（render で再生成される）
  await tryRm(ukiyoePlanJsonPath(jobId));
  await tryRm(wordsJsonPath(jobId));
  await tryRm(finalVideoPath(jobId));

  const job = await loadJob(jobId);
  const now = new Date().toISOString();
  const newImages = reindexGenerated(job.steps.images.generatedScenes ?? []);
  const newVideos = reindexGenerated(job.steps.videos.generatedScenes ?? []);
  const sceneCount = reindexed.length;
  const imagesAllDone = newImages.length === sceneCount;
  const videosAllDone = newVideos.length === sceneCount;

  const next: UkiyoeJob = {
    ...job,
    steps: {
      ...job.steps,
      scenes: {
        ...job.steps.scenes,
        status: "done",
        updatedAt: now,
        error: undefined,
      },
      images: {
        ...job.steps.images,
        status: imagesAllDone ? "done" : "in-progress",
        generatedScenes: newImages,
        updatedAt: now,
        error: undefined,
      },
      videos: {
        ...job.steps.videos,
        status: videosAllDone ? "done" : "in-progress",
        generatedScenes: newVideos,
        updatedAt: now,
        error: undefined,
      },
      render: {
        ...job.steps.render,
        status: "pending",
        updatedAt: now,
        error: undefined,
        outputPath: undefined,
      },
    },
  };
  await saveJob(next);

  const updatedPlan = await readScenePlanJson(jobId);
  return NextResponse.json({
    ok: true,
    job: next,
    scenePlan: updatedPlan,
    merged: {
      removedIndex,
      targetNewIndex,
      direction,
    },
  });
}
