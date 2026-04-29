#!/usr/bin/env node
/**
 * self-motivation 動画の最終レンダリングをバックグラウンドで実行する CLI。
 *
 * 使い方:
 *   pnpm tsx packages/pipeline/src/self-motivation-render-cli.ts <jobId>
 *
 * 動作:
 *   1. job.json を読み、scenes.json / 結合済み audio / オプションの BGM を解決
 *   2. status.json に `state: "running", progress: 0` を書く
 *   3. Remotion で MP4 をレンダリング（onProgress で status.json を更新）
 *   4. 成功時は state="done"、失敗時は state="error" + error を書く
 *
 * Web UI からは API 経由で `child_process.spawn` され、status.json を polling して進捗表示する。
 */
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  channelRootDir,
  concatAudioPath,
  defaultBgmPath,
  jobDir,
  loadJob,
  readScenesJson,
  readScriptJson,
  relFromChannelRoot,
  renderDir,
  renderOutputPath,
  renderStatusPath,
  saveJob,
} from "./self-motivation-index.js";
import { buildLongformCaptionSegments } from "./self-motivation-captions.js";
import { renderSelfMotivationVideo } from "./self-motivation-render.js";

setChannel(SELF_MOTIVATION_CHANNEL);

interface RenderStatus {
  state: "running" | "done" | "error";
  progress: number;
  startedAt: string;
  updatedAt: string;
  error?: string;
  outputPath?: string;
  durationSec?: number;
}

async function writeStatus(jobId: string, status: RenderStatus): Promise<void> {
  await mkdir(renderDir(jobId), { recursive: true });
  await writeFile(
    renderStatusPath(jobId),
    `${JSON.stringify(status, null, 2)}\n`,
    "utf-8",
  );
}

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("usage: self-motivation-render-cli <jobId>");
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  let status: RenderStatus = {
    state: "running",
    progress: 0,
    startedAt,
    updatedAt: startedAt,
  };
  await writeStatus(jobId, status);

  try {
    const job = await loadJob(jobId);
    const scenes = await readScenesJson(jobId);
    if (!scenes) throw new Error("scenes.json が読めません");
    if (scenes.some((s) => !s.audioDurationSec || !s.imagePath)) {
      throw new Error(
        "全シーンに audioDurationSec / imagePath が必要です。先に画像生成と TTS を完了してください",
      );
    }

    const script = await readScriptJson(jobId);

    const channelRoot = channelRootDir();
    const stagedScenes = scenes.map((s) => ({
      ...s,
      imageAbsPath: path.resolve(channelRoot, s.imagePath as string),
    }));

    const audioAbs = path.resolve(channelRoot, "jobs", jobId, "audio", "full.wav");
    const bgmAbs = defaultBgmPath();
    const bgmExists = fs.existsSync(bgmAbs);
    const audioExists = fs.existsSync(audioAbs);

    const captionSegments = buildLongformCaptionSegments(scenes);
    const totalDurationSec = scenes.reduce(
      (s, sc) => s + (sc.audioDurationSec ?? 0),
      0,
    );

    const outputPath = renderOutputPath(jobId);

    await renderSelfMotivationVideo({
      outputPath,
      scenes: stagedScenes,
      audioAbsPath: audioExists ? audioAbs : undefined,
      bgmAbsPath: bgmExists ? bgmAbs : undefined,
      captionSegments,
      totalDurationSec,
      script: script ?? undefined,
      onProgress: async (progress) => {
        status = {
          ...status,
          state: "running",
          progress,
          updatedAt: new Date().toISOString(),
        };
        // 進捗ノイズ低減のため 0.02 単位で書き込む
        if (progress === 0 || progress === 1 || Math.abs((progress * 50) - Math.round(progress * 50)) < 0.001) {
          await writeStatus(jobId, status);
        }
      },
    });

    const doneAt = new Date().toISOString();
    status = {
      state: "done",
      progress: 1,
      startedAt,
      updatedAt: doneAt,
      outputPath: relFromChannelRoot(outputPath),
      durationSec: totalDurationSec,
    };
    await writeStatus(jobId, status);

    // Job step も完了にする
    const next = await loadJob(jobId);
    next.steps.render = {
      ...next.steps.render,
      status: "done",
      progress: 1,
      outputPath: relFromChannelRoot(outputPath),
      durationSec: totalDurationSec,
      generatedAt: doneAt,
      updatedAt: doneAt,
      error: undefined,
    };
    await saveJob(next);

    console.log(`✅ rendered: ${outputPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const at = new Date().toISOString();
    status = {
      ...status,
      state: "error",
      updatedAt: at,
      error: msg,
    };
    try {
      await writeStatus(jobId, status);
      const next = await loadJob(jobId);
      next.steps.render = {
        ...next.steps.render,
        status: "error",
        error: msg,
        updatedAt: at,
      };
      await saveJob(next);
    } catch {
      // status / job 書き込み失敗時もプロセスは error 終了させる
    }
    console.error(`✗ render failed: ${msg}`);
    process.exit(1);
  }

  // 明示的に正常終了させて、bundle dev server などのバックグラウンド作業をクリーンアップ
  process.exit(0);
}

void main();

// 利用しない使い分け関数を export しておく（ESM 副作用 import の警告抑止用）
export { jobDir, concatAudioPath };
