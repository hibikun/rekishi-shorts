import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import {
  RenderPlanSchema,
  ScriptSchema,
  type RenderPlan,
  type Script,
  type Topic,
} from "@rekishi/shared";
import { generateScript } from "./script-generator.js";
import { planScenes } from "./scene-planner.js";
import { resolveSceneAssets } from "./asset-resolver.js";
import { synthesizeNarration } from "./tts-generator.js";
import { alignCaptions } from "./asr-aligner.js";
import { alignScenesToAudio } from "./scene-aligner.js";
import { LocalStorageAdapter, jobPath } from "./storage/local.js";
import { FURIGANA_MAP } from "./furigana.js";
import { dataPath } from "./config.js";
import { CostTracker } from "./cost-tracker.js";
import {
  draftMdToScript,
  findOrphanKeyTerms,
  scriptToDraftMd,
} from "./draft-io.js";

export interface DraftResult {
  jobId: string;
  script: Script;
  draftPath: string;
  tracker: CostTracker;
}

export interface BuildOptions {
  jobId: string;
  /** 事前にロードされた Script（draft.md ベース）を使う場合 */
  script?: Script;
  allowImageGeneration?: boolean;
  tracker?: CostTracker;
}

export interface GenerateOptions {
  topic: Topic;
  jobId?: string;
  allowImageGeneration?: boolean;
}

/**
 * Stage 1: 台本のみ生成し、人間レビュー用の draft.md を出力する。
 * build は呼ばない。
 */
export async function runDraftStage(topic: Topic, jobId?: string): Promise<DraftResult> {
  const id = jobId ?? shortId();
  const tracker = new CostTracker();
  const storage = new LocalStorageAdapter();
  await storage.ensureJobDir(id, "scripts");

  log(`📝 [draft] Gemini Pro で台本生成中...`);
  const { script, usage } = await generateScript(topic);
  tracker.addGemini("script", usage.model, usage.inputTokens, usage.outputTokens);
  await writeJson(jobPath(id, "scripts", "script.json"), script);
  log(chalk.dim(`   ${script.narration.length}文字 / 推定${script.estimatedDurationSec}秒 / in=${usage.inputTokens}tok out=${usage.outputTokens}tok`));

  const draftPath = jobPath(id, "scripts", "draft.md");
  await fs.mkdir(path.dirname(draftPath), { recursive: true });
  await fs.writeFile(draftPath, scriptToDraftMd(script), "utf-8");

  return { jobId: id, script, draftPath, tracker };
}

/**
 * Stage 2: script (draft.md から再構築済み想定) を受け取り、
 * シーン分割 → TTS → Whisper → scene align → 画像 → RenderPlan の順で実行する。
 */
export async function runBuildStage(opts: BuildOptions): Promise<{ plan: RenderPlan; tracker: CostTracker }> {
  const jobId = opts.jobId;
  const tracker = opts.tracker ?? new CostTracker();
  const storage = new LocalStorageAdapter();
  await storage.ensureJobDir(jobId, "scripts");
  await storage.ensureJobDir(jobId, "audio");
  await storage.ensureJobDir(jobId, "images");
  await storage.ensureJobDir(jobId, "captions");

  const script = opts.script ?? (await loadScriptFromJob(jobId));

  const orphans = findOrphanKeyTerms(script);
  if (orphans.length > 0) {
    log(chalk.yellow(`   ⚠ narration に含まれない keyTerms: ${orphans.join(", ")} （popup 表示されません）`));
  }

  log(`🎬 [1/4] Gemini Flash でシーン分割中...`);
  const sceneResult = await planScenes(script);
  const scenePlan = sceneResult.plan;
  tracker.addGemini("scene-plan", sceneResult.usage.model, sceneResult.usage.inputTokens, sceneResult.usage.outputTokens);
  await writeJson(jobPath(jobId, "scripts", "scene-plan.json"), scenePlan);
  log(chalk.dim(`   ${scenePlan.scenes.length}シーン / in=${sceneResult.usage.inputTokens}tok out=${sceneResult.usage.outputTokens}tok`));

  log(`🎙️  [2/4] Gemini 3.1 Flash TTS でナレーション合成中...`);
  const audioDestPath = jobPath(jobId, "audio", "narration.wav");
  const tts = await synthesizeNarration(script.narration, audioDestPath, {
    readings: script.readings,
    furigana: FURIGANA_MAP,
    hook: script.hook,
  });
  tracker.addGemini("tts", tts.usage.model, tts.usage.inputTokens, tts.usage.outputTokens);
  log(chalk.dim(`   ${tts.characters}文字 / 合成${tts.approxDurationSec.toFixed(2)}秒 / in=${tts.usage.inputTokens}tok out=${tts.usage.outputTokens}tok`));

  log(`📝 [3/4] Whisper + gpt-4o-mini-transcribe で字幕タイムスタンプ取得中...`);
  const alignResult = await alignCaptions(tts.path, {
    scriptText: script.narration,
  });
  const { words, totalDurationSec, usage: asrUsage, brokenByGuard, qualitySignals } = alignResult;
  tracker.addWhisper("whisper", asrUsage.whisperAudioSec);
  tracker.addGpt4oMiniTranscribe("transcribe-text", asrUsage.textTranscribeAudioSec);
  await writeJson(jobPath(jobId, "captions", "words.json"), {
    words,
    totalDurationSec,
    brokenByGuard,
    qualitySignals,
  });
  if (brokenByGuard) {
    log(chalk.yellow(`   ⚠ whisper-1 が破綻検出: ${qualitySignals.reasons.join(", ")}`));
    log(chalk.yellow(`     → script.narration を線形配分した words に置換しました`));
  }
  log(chalk.dim(`   ${words.length}単語 / 実測${totalDurationSec.toFixed(2)}秒`));

  const alignment = alignScenesToAudio(scenePlan.scenes, words, totalDurationSec);
  const rescaledScenes = alignment.scenes;
  const captionSegments = alignment.captionSegments;
  if (alignment.fallbackUsed) {
    log(chalk.yellow(`   ⚠ scene alignment fallback used — 実発話とシーン境界がズレる可能性あり`));
  }

  log(`🖼️  [4/4] 画像取得中 (Wikimedia → Nano Banana fallback)...`);
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
    captionSegments,
    totalDurationSec,
    createdAt: new Date().toISOString(),
  });

  await writeJson(jobPath(jobId, "scripts", "render-plan.json"), plan);
  await writeJson(jobPath(jobId, "scripts", "cost.json"), { entries: tracker.getEntries(), totalUsd: tracker.totalUsd(), totalJpy: tracker.totalJpy() });
  log(chalk.green(`✅ RenderPlan 保存: ${jobPath(jobId, "scripts", "render-plan.json")}`));
  return { plan, tracker };
}

/**
 * 互換: topic から plan まで一気通貫で実行する（レビューなし）。
 */
export async function generatePlan(opts: GenerateOptions): Promise<{ plan: RenderPlan; tracker: CostTracker }> {
  const draft = await runDraftStage(opts.topic, opts.jobId);
  return runBuildStage({
    jobId: draft.jobId,
    script: draft.script,
    allowImageGeneration: opts.allowImageGeneration,
    tracker: draft.tracker,
  });
}

/**
 * draft.md を読み込んで Script を再構築する。draft.md がなければ script.json をそのまま返す。
 */
export async function loadScriptFromJob(jobId: string): Promise<Script> {
  const scriptJsonPath = jobPath(jobId, "scripts", "script.json");
  const draftMdPath = jobPath(jobId, "scripts", "draft.md");

  const scriptJsonRaw = await fs.readFile(scriptJsonPath, "utf-8");
  const original = ScriptSchema.parse(JSON.parse(scriptJsonRaw));

  try {
    const md = await fs.readFile(draftMdPath, "utf-8");
    return draftMdToScript(md, original);
  } catch {
    return original;
  }
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
