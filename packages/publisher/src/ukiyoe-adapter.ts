import fs from "node:fs/promises";
import path from "node:path";
import { RenderPlanSchema, UkiyoePlanSchema, type RenderPlan } from "@rekishi/shared";
import { dataPath } from "./config.js";

/**
 * ukiyoe チャンネルの ukiyoe-plan.json を、publisher が前提とする RenderPlan 形に
 * 最小変換する。ファイルは保存せず、メモリ上で組み立てるだけ。
 *
 * metadata-generator が参照するのは `script.topic / script.keyTerms / script.narration` と
 * `images` のみで、後者は ukiyoe では Wikimedia attribution が不要なので空配列で良い。
 */
export async function loadUkiyoePlanAsRenderPlan(jobId: string): Promise<RenderPlan> {
  const p = path.join(dataPath("scripts", jobId), "ukiyoe-plan.json");
  const raw = await fs.readFile(p, "utf-8");
  const ukiyoe = UkiyoePlanSchema.parse(JSON.parse(raw));

  const adapted = {
    id: ukiyoe.id,
    script: {
      topic: {
        title: ukiyoe.topic,
        era: ukiyoe.era ?? undefined,
        subject: "日本史",
        target: "汎用",
        format: "single",
      },
      narration: ukiyoe.narration,
      hook: ukiyoe.hook,
      title: { top: "", bottom: ukiyoe.topic.slice(0, 20) },
      body: ukiyoe.narration,
      closing: ukiyoe.hook,
      keyTerms: ukiyoe.keyTerms,
      readings: ukiyoe.readings,
      estimatedDurationSec: ukiyoe.totalDurationSec,
    },
    scenes: ukiyoe.scenes.map((s) => ({
      index: s.index,
      narration: s.narration,
      imageQueryJa: ukiyoe.topic,
      imageQueryEn: s.imagePrompt.slice(0, 200),
      imagePromptEn: s.imagePrompt,
      durationSec: s.durationSec,
    })),
    images: ukiyoe.scenes.map((s) => ({
      sceneIndex: s.index,
      source: "generated" as const,
      path: s.imagePath,
      license: "OpenAI",
    })),
    audio: {
      path: ukiyoe.audioPath,
      durationSec: ukiyoe.totalDurationSec,
      format: "wav" as const,
    },
    captions: ukiyoe.captions,
    captionSegments: ukiyoe.captionSegments,
    totalDurationSec: ukiyoe.totalDurationSec,
    createdAt: ukiyoe.createdAt,
  };

  return RenderPlanSchema.parse(adapted);
}
