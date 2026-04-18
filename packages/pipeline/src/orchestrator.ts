import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import {
  RenderPlanSchema,
  type RenderPlan,
  type Scene,
  type Topic,
} from "@rekishi/shared";
import { generateScript } from "./script-generator.js";
import { planScenes } from "./scene-planner.js";
import { resolveSceneAssets } from "./asset-resolver.js";
import { synthesizeNarration } from "./tts-generator.js";
import { alignCaptions } from "./asr-aligner.js";
import { LocalStorageAdapter, jobPath } from "./storage/local.js";
import { FURIGANA_MAP } from "./furigana.js";
import { dataPath } from "./config.js";
import { CostTracker } from "./cost-tracker.js";

export interface GenerateOptions {
  topic: Topic;
  jobId?: string;
  allowImageGeneration?: boolean;
}

export async function generatePlan(opts: GenerateOptions): Promise<{ plan: RenderPlan; tracker: CostTracker }> {
  const jobId = opts.jobId ?? shortId();
  const tracker = new CostTracker();
  const storage = new LocalStorageAdapter();
  await storage.ensureJobDir(jobId, "scripts");
  await storage.ensureJobDir(jobId, "audio");
  await storage.ensureJobDir(jobId, "images");
  await storage.ensureJobDir(jobId, "captions");

  log(`📝 [1/5] Gemini Pro で台本生成中...`);
  const scriptResult = await generateScript(opts.topic);
  const script = scriptResult.script;
  tracker.addGemini("script", scriptResult.usage.model, scriptResult.usage.inputTokens, scriptResult.usage.outputTokens);
  await writeJson(jobPath(jobId, "scripts", "script.json"), script);
  log(chalk.dim(`   ${script.narration.length}文字 / 推定${script.estimatedDurationSec}秒 / in=${scriptResult.usage.inputTokens}tok out=${scriptResult.usage.outputTokens}tok`));

  log(`🎬 [2/5] Gemini Flash でシーン分割中...`);
  const sceneResult = await planScenes(script);
  const scenePlan = sceneResult.plan;
  tracker.addGemini("scene-plan", sceneResult.usage.model, sceneResult.usage.inputTokens, sceneResult.usage.outputTokens);
  await writeJson(jobPath(jobId, "scripts", "scene-plan.json"), scenePlan);
  log(chalk.dim(`   ${scenePlan.scenes.length}シーン / in=${sceneResult.usage.inputTokens}tok out=${sceneResult.usage.outputTokens}tok`));

  log(`🎙️  [3/5] Gemini 3.1 Flash TTS でナレーション合成中...`);
  const audioDestPath = jobPath(jobId, "audio", "narration.wav");
  const tts = await synthesizeNarration(script.narration, audioDestPath, {
    furigana: FURIGANA_MAP,
  });
  tracker.addGemini("tts", tts.usage.model, tts.usage.inputTokens, tts.usage.outputTokens);
  log(chalk.dim(`   ${tts.characters}文字 / 合成${tts.approxDurationSec.toFixed(2)}秒 / in=${tts.usage.inputTokens}tok out=${tts.usage.outputTokens}tok`));

  log(`📝 [4/5] Whisper で字幕タイムスタンプ取得中 (台本バイアス付き)...`);
  const { words, totalDurationSec } = await alignCaptions(tts.path, {
    scriptText: script.narration,
  });
  tracker.addWhisper("whisper", totalDurationSec);
  await writeJson(jobPath(jobId, "captions", "words.json"), { words, totalDurationSec });
  log(chalk.dim(`   ${words.length}単語 / 実測${totalDurationSec.toFixed(2)}秒`));

  // シーン時間を実音声 durationSec にリスケール
  const rescaledScenes = rescaleScenes(scenePlan.scenes, totalDurationSec);

  log(`🖼️  [5/5] 画像取得中 (Wikimedia → Nano Banana fallback)...`);
  const resolved = await resolveSceneAssets(rescaledScenes, { jobId, allowGeneration: opts.allowImageGeneration });
  const images = resolved.assets;
  tracker.addImage("nano-banana", resolved.usage.generatedImages);
  tracker.addFree("wikimedia", `${images.filter((i) => i.source === "wikimedia").length} images`);
  await writeJson(jobPath(jobId, "scripts", "images.json"), images);
  const wikiCount = images.filter((i) => i.source === "wikimedia").length;
  const genCount = images.filter((i) => i.source === "generated").length;
  const fallbackCount = images.filter((i) => i.source === "fallback").length;
  log(chalk.dim(`   Wikimedia ${wikiCount} / 生成 ${genCount} / 黒背景 ${fallbackCount}`));

  const plan = RenderPlanSchema.parse({
    id: jobId,
    script,
    scenes: rescaledScenes,
    images,
    audio: {
      path: tts.path,
      durationSec: totalDurationSec,
      format: "mp3",
    },
    captions: words,
    totalDurationSec,
    createdAt: new Date().toISOString(),
  });

  await writeJson(jobPath(jobId, "scripts", "render-plan.json"), plan);
  await writeJson(jobPath(jobId, "scripts", "cost.json"), { entries: tracker.getEntries(), totalUsd: tracker.totalUsd(), totalJpy: tracker.totalJpy() });
  log(chalk.green(`✅ RenderPlan 保存: ${jobPath(jobId, "scripts", "render-plan.json")}`));
  return { plan, tracker };
}

function rescaleScenes(scenes: Scene[], targetTotalSec: number): Scene[] {
  const currentTotal = scenes.reduce((s, sc) => s + sc.durationSec, 0);
  if (currentTotal === 0) return scenes;
  const factor = targetTotalSec / currentTotal;
  return scenes.map((sc) => ({ ...sc, durationSec: Number((sc.durationSec * factor).toFixed(3)) }));
}

async function writeJson(p: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf-8");
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}

function log(msg: string): void {
  console.log(msg);
}

export function getJobOutputDir(): string {
  return dataPath("videos");
}
