import fs from "node:fs";
import path from "node:path";
import {
  UkiyoePlanSchema,
  type CaptionSegment,
  type CaptionWord,
  type UkiyoePlan,
  type UkiyoeScene,
} from "@rekishi/shared";
import type { UkiyoeScript } from "./ukiyoe-script-generator.js";
import type { UkiyoeScenePlan } from "./ukiyoe-scene-planner.js";
import { sceneIndexToken } from "./ukiyoe-paths.js";

export interface BuildUkiyoePlanInput {
  jobId: string;
  script: UkiyoeScript;
  scenePlan: UkiyoeScenePlan;
  /** 静止画ディレクトリ（scene-NN.png の親） */
  imagesDir: string;
  /** 動画ディレクトリ（scene-NN.mp4 の親） */
  videosDir: string;
  audioPath: string;
  captions?: CaptionWord[];
  captionSegments?: CaptionSegment[];
}

export function buildUkiyoePlan(input: BuildUkiyoePlanInput): UkiyoePlan {
  const scenes: UkiyoeScene[] = input.scenePlan.scenes.map((s) => {
    const token = sceneIndexToken(s.index);
    return {
      index: s.index,
      narration: s.narration,
      durationSec: s.durationSec,
      imagePath: path.join(input.imagesDir, `scene-${token}.png`),
      videoPath: path.join(input.videosDir, `scene-${token}.mp4`),
      imagePrompt: s.imagePrompt,
      videoPrompt: s.videoPrompt,
      actionTag: s.actionTag,
      cameraFixed: s.cameraFixed,
    };
  });

  const totalDurationSec = scenes.reduce((acc, sc) => acc + sc.durationSec, 0);

  const plan: UkiyoePlan = {
    id: input.jobId,
    topic: input.script.topic,
    era: input.script.era,
    hook: input.script.hook,
    narration: input.script.narration,
    keyTerms: input.script.keyTerms,
    readings: input.script.readings,
    scenes,
    audioPath: input.audioPath,
    captions: input.captions ?? [],
    captionSegments: input.captionSegments ?? [],
    totalDurationSec,
    createdAt: new Date().toISOString(),
  };

  return UkiyoePlanSchema.parse(plan);
}

export function writeUkiyoePlan(plan: UkiyoePlan, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
}

export function readUkiyoePlan(planPath: string): UkiyoePlan {
  const raw = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  return UkiyoePlanSchema.parse(raw);
}
