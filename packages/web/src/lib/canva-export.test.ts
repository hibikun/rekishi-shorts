import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import type {
  ManabilabCanvaJob,
  ManabilabCanvaScene,
  ManabilabCanvaScript,
} from "@rekishi/shared";
import { buildCanvaExportPlan } from "./canva-export";
import { channelRootDir } from "./canva-job";

const jobId = "mlc-test-export";
const channelRoot = channelRootDir();

function abs(relPath: string): string {
  return path.join(channelRoot, relPath);
}

const baseJob: ManabilabCanvaJob = {
  id: jobId,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:00.000Z",
  topic: {
    title: "暗記は寝る前にしろ",
    subject: "学習科学",
    target: "汎用",
    format: "single",
  },
  steps: {
    topic: { status: "done" },
    research: { status: "done", sources: [], queries: [] },
    script: { status: "done", estimatedDurationSec: 42 },
    scenes: { status: "done" },
    images: { status: "done" },
    tts: {
      status: "done",
      voiceProvider: "gemini",
      voiceName: "Charon",
      concatAudioPath: `jobs/${jobId}/audio/full.wav`,
    },
    export: { status: "pending" },
  },
};

const script: ManabilabCanvaScript = {
  topic: baseJob.topic,
  hook: "その暗記、時間帯で損してます。",
  statements: [
    { label: "寝る前", claim: "寝る前の想起が効く。", backupLogic: "" },
    { label: "朝確認", claim: "朝の確認で固定する。", backupLogic: "" },
  ],
  cta: "今夜5分だけ試して。",
  punchline: "脳に残業代は出ません。",
  title: { top: "暗記するなら", bottom: "寝る前5分" },
  readings: [],
  estimatedDurationSec: 42,
};

function scene(index: number, patch: Partial<ManabilabCanvaScene> = {}): ManabilabCanvaScene {
  return {
    index,
    source: index === 1 ? { kind: "hook" } : { kind: "statement", statementIndex: 0 },
    narration: `scene ${index} narration`,
    caption: `scene ${index}`,
    imagePromptJa: "",
    imagePromptEn: "",
    seedancePromptJa: "",
    seedancePromptEn: "",
    imageCandidates: [],
    selectedCandidateIndex: 0,
    imagePath: `jobs/${jobId}/images/scene-${String(index).padStart(2, "0")}.png`,
    audioPath: `jobs/${jobId}/audio/scene-${String(index).padStart(2, "0")}.wav`,
    videoPath: `jobs/${jobId}/videos/scene-${String(index).padStart(2, "0")}.mp4`,
    ...patch,
  } as ManabilabCanvaScene;
}

function existsFrom(relPaths: string[]): (absPath: string) => Promise<boolean> {
  const files = new Set(relPaths.map(abs));
  return async (absPath: string) => files.has(absPath);
}

describe("buildCanvaExportPlan", () => {
  it("requires a selected image for every scene", async () => {
    const plan = await buildCanvaExportPlan({
      job: baseJob,
      script,
      scenes: [scene(1, { imagePath: undefined, selectedCandidateIndex: undefined })],
      generatedAt: "2026-04-30T00:00:00.000Z",
      channelRoot,
      exists: existsFrom([
        `jobs/${jobId}/research.md`,
        `jobs/${jobId}/script.json`,
        `jobs/${jobId}/scenes.json`,
      ]),
    });

    assert.match(plan.requiredErrors.join("\n"), /画像候補が未選択/);
    assert.equal(plan.manifest.assetCounts.images, 0);
  });

  it("treats video and audio as optional warnings", async () => {
    const plan = await buildCanvaExportPlan({
      job: { ...baseJob, steps: { ...baseJob.steps, tts: { ...baseJob.steps.tts, concatAudioPath: undefined } } },
      script,
      scenes: [scene(1, { audioPath: undefined, videoPath: undefined })],
      generatedAt: "2026-04-30T00:00:00.000Z",
      channelRoot,
      exists: existsFrom([
        `jobs/${jobId}/research.md`,
        `jobs/${jobId}/script.json`,
        `jobs/${jobId}/scenes.json`,
        `jobs/${jobId}/images/scene-01.png`,
      ]),
    });

    assert.deepEqual(plan.requiredErrors, []);
    assert.match(plan.warnings.join("\n"), /音声は未生成/);
    assert.match(plan.warnings.join("\n"), /動画は未生成/);
    assert.match(plan.warnings.join("\n"), /結合音声 full\.wav は未生成/);
    assert.equal(plan.manifest.assetCounts.images, 1);
    assert.equal(plan.manifest.assetCounts.sceneAudio, 0);
    assert.equal(plan.manifest.assetCounts.videos, 0);
  });

  it("adds selected images, optional videos, scene audio, and full audio to the manifest", async () => {
    const plan = await buildCanvaExportPlan({
      job: baseJob,
      script,
      scenes: [scene(1)],
      generatedAt: "2026-04-30T00:00:00.000Z",
      channelRoot,
      exists: existsFrom([
        `jobs/${jobId}/research.md`,
        `jobs/${jobId}/script.json`,
        `jobs/${jobId}/scenes.json`,
        `jobs/${jobId}/images/scene-01.png`,
        `jobs/${jobId}/videos/scene-01.mp4`,
        `jobs/${jobId}/audio/scene-01.wav`,
        `jobs/${jobId}/audio/full.wav`,
      ]),
    });

    assert.deepEqual(plan.requiredErrors, []);
    assert.equal(plan.manifest.scenes[0]?.image, `jobs/${jobId}/images/scene-01.png`);
    assert.equal(plan.manifest.scenes[0]?.video, `jobs/${jobId}/videos/scene-01.mp4`);
    assert.equal(plan.manifest.scenes[0]?.audio, `jobs/${jobId}/audio/scene-01.wav`);
    assert.equal(plan.manifest.files.concatAudio, `jobs/${jobId}/audio/full.wav`);
    assert.deepEqual(plan.manifest.assetCounts, {
      images: 1,
      videos: 1,
      sceneAudio: 1,
      concatAudio: 1,
    });
  });
});
