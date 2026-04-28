import fs from "node:fs/promises";
import path from "node:path";
import { RenderPlanSchema, type RenderPlan } from "@rekishi/shared";
import { config } from "./config.js";

/**
 * 学びラボ (manabilab) のプラン JSON を、publisher が前提とする RenderPlan 形に
 * 最小変換する。manabilab plan は packages/channels/manabilab/plans/<planId>.json に置く
 * (data/<channel>/scripts/<jobId>/render-plan.json ではない)。
 *
 * metadata-generator が参照するのは `script.topic / script.keyTerms / script.narration` と
 * `images` のみ。manabilab はキーワード popup 機能を使わないため keyTerms は空配列で良い。
 */

interface ManabilabImageScene {
  index: number;
  kind: "image";
  beat: string;
  startSec: number;
  endSec: number;
  narration: string;
  imagePath: string;
}

interface ManabilabTitleCardScene {
  index: number;
  kind: "title-card";
  beat: string;
  startSec: number;
  endSec: number;
  narration: string;
}

type ManabilabScene = ManabilabImageScene | ManabilabTitleCardScene;

interface ManabilabPlan {
  id: string;
  title: string;
  totalDurationSec: number;
  audio: {
    path: string;
    voiceProvider?: string;
    voiceName?: string;
  };
  scenes: ManabilabScene[];
}

export function manabilabPlanJsonPath(planId: string): string {
  return path.join(
    config.paths.repoRoot,
    "packages",
    "channels",
    "manabilab",
    "plans",
    `${planId}.json`,
  );
}

export async function loadManabilabPlanAsRenderPlan(planId: string): Promise<RenderPlan> {
  const p = manabilabPlanJsonPath(planId);
  const raw = await fs.readFile(p, "utf-8");
  const m = JSON.parse(raw) as ManabilabPlan;

  const allNarration = m.scenes.map((s) => s.narration).join(" ");
  const firstNarration = m.scenes[0]?.narration ?? "";
  const lastNarration = m.scenes[m.scenes.length - 1]?.narration ?? "";

  // audio.path は repo root 相対 (例: packages/renderer/public/manabilab/audio/narration-001.wav)。
  // RenderPlan 上は文字列として保持。upload 側では参照しないので絶対化は不要。
  const audioPath = path.isAbsolute(m.audio.path)
    ? m.audio.path
    : path.join(config.paths.repoRoot, m.audio.path);

  const adapted = {
    id: m.id,
    script: {
      topic: {
        title: m.title,
        era: undefined,
        subject: "学習科学",
        target: "汎用",
        format: "single",
      },
      narration: allNarration,
      hook: firstNarration,
      title: { top: "", bottom: m.title.slice(0, 20) },
      body: allNarration,
      closing: lastNarration,
      keyTerms: [],
      readings: {},
      estimatedDurationSec: m.totalDurationSec,
    },
    scenes: m.scenes.map((s) => ({
      index: s.index,
      narration: s.narration,
      imageQueryJa: m.title,
      imageQueryEn: s.beat,
      imagePromptEn: s.kind === "image" ? `manabilab/${path.basename(s.imagePath)}` : `title-card:${s.beat}`,
      durationSec: s.endSec - s.startSec,
    })),
    images: m.scenes
      .filter((s): s is ManabilabImageScene => s.kind === "image")
      .map((s) => ({
        sceneIndex: s.index,
        source: "generated" as const,
        path: path.isAbsolute(s.imagePath) ? s.imagePath : path.join(config.paths.repoRoot, s.imagePath),
        license: "Generated (Gemini Image / Seedance img2video)",
      })),
    audio: {
      path: audioPath,
      durationSec: m.totalDurationSec,
      format: "wav" as const,
    },
    captions: [],
    captionSegments: [],
    totalDurationSec: m.totalDurationSec,
    createdAt: new Date().toISOString(),
  };

  return RenderPlanSchema.parse(adapted);
}
