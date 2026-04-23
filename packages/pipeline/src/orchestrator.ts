import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import {
  RenderPlanSchema,
  ScriptSchema,
  ScenePlanSchema,
  ImageAssetSchema,
  CaptionWordSchema,
  type RenderPlan,
  type ScenePlan,
  type ImageAsset,
  type CaptionWord,
  type Script,
  type Topic,
} from "@rekishi/shared";
import { z } from "zod";
import { generateScript } from "./script-generator.js";
import { generateResearch } from "./research-generator.js";
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

export interface ResearchStageResult {
  jobId: string;
  researchPath: string;
  tracker: CostTracker;
  sourceCount: number;
  queryCount: number;
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
 * Stage 0: Gemini + Google Search でリサーチ資料 (research.md) を生成する。
 * draft の前段として任意で実行。人間がレビューしてから draft に引き継ぐ。
 */
export async function runResearchStage(topic: Topic, jobId?: string): Promise<ResearchStageResult> {
  const id = jobId ?? shortId();
  const tracker = new CostTracker();
  const storage = new LocalStorageAdapter();
  await storage.ensureJobDir(id, "scripts");

  log(`🔎 [research] Gemini Pro + Google Search でリサーチ中...`);
  const res = await generateResearch(topic);
  tracker.addGemini("research", res.usage.model, res.usage.inputTokens, res.usage.outputTokens);

  const researchPath = jobPath(id, "scripts", "research.md");
  await fs.mkdir(path.dirname(researchPath), { recursive: true });
  await fs.writeFile(researchPath, res.markdown, "utf-8");
  await writeJson(jobPath(id, "scripts", "research-sources.json"), {
    queries: res.queries,
    sources: res.sources,
    generatedAt: new Date().toISOString(),
    topic,
  });

  log(chalk.dim(`   ${res.sources.length}件のソース / ${res.queries.length}件の検索クエリ / in=${res.usage.inputTokens}tok out=${res.usage.outputTokens}tok`));

  return { jobId: id, researchPath, tracker, sourceCount: res.sources.length, queryCount: res.queries.length };
}

/**
 * Stage 1: 台本のみ生成し、人間レビュー用の draft.md を出力する。
 * build は呼ばない。jobId を指定すると既存ジョブの research.md を読み込んで注入する。
 */
export async function runDraftStage(topic: Topic, jobId?: string): Promise<DraftResult> {
  const id = jobId ?? shortId();
  const tracker = new CostTracker();
  const storage = new LocalStorageAdapter();
  await storage.ensureJobDir(id, "scripts");

  const researchMd = await tryReadResearch(id);

  log(`📝 [draft] Gemini Pro で台本生成中...`);
  const { script, usage } = await generateScript(topic, researchMd);
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
    readings: script.readings,
    keyTerms: script.keyTerms,
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

  const alignment = alignScenesToAudio(scenePlan.scenes, words, totalDurationSec, {
    audioPath: tts.path,
    brokenAsr: brokenByGuard,
  });
  const rescaledScenes = alignment.scenes;
  const captionSegments = alignment.captionSegments;
  if (alignment.vadUsed) {
    log(chalk.cyan(`   🎯 VAD-based scene boundaries: ${alignment.matchedByVad}/${scenePlan.scenes.length - 1} 境界が無音マッチ`));
  } else if (alignment.fallbackUsed) {
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

export interface RealignOptions {
  jobId: string;
  /** Whisper を再実行する（既存 words.json があっても無視） */
  freshAsr?: boolean;
  /** Remotion レンダリングをスキップして render-plan.json だけ更新 */
  skipRender?: boolean;
  /** VAD フォールバックを無効化（比較検証用: main ブランチ相当の線形配分を再現） */
  disableVad?: boolean;
  /** 出力 render-plan のファイル名サフィックス（複数バリアント共存用） */
  planSuffix?: string;
  tracker?: CostTracker;
}

/**
 * 既存ジョブの script / scene-plan / narration.wav / images を再利用し、
 * ASR + scene alignment + render-plan 再生成 + レンダリングを行う。
 *
 * 目的: VAD/scene-aligner の調整を TTS・画像生成コストをかけずに回す。
 */
export async function runRealignStage(opts: RealignOptions): Promise<{ plan: RenderPlan; tracker: CostTracker }> {
  const jobId = opts.jobId;
  const tracker = opts.tracker ?? new CostTracker();

  log(`🔁 [realign] 既存ジョブ ${jobId} の再整列`);

  const script = await loadScriptFromJob(jobId);
  const scenePlan = await readJson(jobPath(jobId, "scripts", "scene-plan.json"), ScenePlanSchema);
  const images = await readJson(jobPath(jobId, "scripts", "images.json"), z.array(ImageAssetSchema));

  const audioPath = jobPath(jobId, "audio", "narration.wav");
  try {
    await fs.access(audioPath);
  } catch {
    throw new Error(`narration.wav が見つかりません: ${audioPath}`);
  }

  const wordsJsonPath = jobPath(jobId, "captions", "words.json");
  let words: CaptionWord[];
  let totalDurationSec: number;
  let brokenByGuard: boolean;
  let qualitySignals: unknown;

  const canReuse = !opts.freshAsr && (await fileExists(wordsJsonPath));
  if (canReuse) {
    log(`📝 [realign] 既存 words.json を再利用 (--fresh-asr で再実行可)`);
    const raw = await fs.readFile(wordsJsonPath, "utf-8");
    const parsed = z
      .object({
        words: z.array(CaptionWordSchema),
        totalDurationSec: z.number(),
        brokenByGuard: z.boolean().default(false),
        qualitySignals: z.unknown().optional(),
      })
      .parse(JSON.parse(raw));
    words = parsed.words;
    totalDurationSec = parsed.totalDurationSec;
    brokenByGuard = parsed.brokenByGuard;
    qualitySignals = parsed.qualitySignals;
  } else {
    log(`📝 [realign] Whisper + gpt-4o-mini-transcribe 実行中...`);
    const alignResult = await alignCaptions(audioPath, {
      scriptText: script.narration,
      readings: script.readings,
      keyTerms: script.keyTerms,
    });
    tracker.addWhisper("whisper", alignResult.usage.whisperAudioSec);
    tracker.addGpt4oMiniTranscribe("transcribe-text", alignResult.usage.textTranscribeAudioSec);
    words = alignResult.words;
    totalDurationSec = alignResult.totalDurationSec;
    brokenByGuard = alignResult.brokenByGuard;
    qualitySignals = alignResult.qualitySignals;
    await writeJson(wordsJsonPath, { words, totalDurationSec, brokenByGuard, qualitySignals });
  }
  if (brokenByGuard) {
    log(chalk.yellow(`   ⚠ whisper-1 破綻検出 (保存済みメタ): ${JSON.stringify(qualitySignals)}`));
  }
  log(chalk.dim(`   ${words.length}単語 / 実測${totalDurationSec.toFixed(2)}秒`));

  const alignment = alignScenesToAudio(scenePlan.scenes, words, totalDurationSec, {
    audioPath,
    brokenAsr: brokenByGuard && !opts.disableVad,
  });
  if (alignment.fallbackUsed) {
    log(chalk.yellow(`   ⚠ scene alignment fallback used`));
  }
  if (alignment.vadUsed) {
    log(chalk.cyan(`   🎯 VAD-based scene boundaries used`));
  }
  if (opts.disableVad) {
    log(chalk.yellow(`   (--no-vad: VAD は無効化されています)`));
  }

  const plan = RenderPlanSchema.parse({
    id: jobId,
    script,
    scenes: alignment.scenes,
    images,
    audio: {
      path: audioPath,
      durationSec: totalDurationSec,
      format: "mp3",
    },
    captions: words,
    captionSegments: alignment.captionSegments,
    totalDurationSec,
    createdAt: new Date().toISOString(),
  });
  const planFileName = opts.planSuffix ? `render-plan-${opts.planSuffix}.json` : "render-plan.json";
  await writeJson(jobPath(jobId, "scripts", planFileName), plan);
  log(chalk.green(`✅ ${planFileName} 更新完了`));

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

async function readJson<T>(p: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await fs.readFile(p, "utf-8");
  return schema.parse(JSON.parse(raw));
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 指定 jobId に research.md があれば読み込んで返す。無ければ警告ログを出して undefined を返す。
 */
async function tryReadResearch(jobId: string): Promise<string | undefined> {
  const p = jobPath(jobId, "scripts", "research.md");
  try {
    const md = await fs.readFile(p, "utf-8");
    log(chalk.dim(`   📎 research.md を読み込み (${md.length}字) → プロンプトに注入`));
    return md;
  } catch {
    log(chalk.yellow(`   ⚠ research.md なし — モデル内部知識のみで生成します (pnpm research で事前に資料生成可)`));
    return undefined;
  }
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
