import fs from "node:fs";
import path from "node:path";
import {
  KoseiAnimationPlanSchema,
  type CaptionSegment,
  type CaptionWord,
  type KoseiAnimationPlan,
  type KoseiAnimationScene,
} from "@rekishi/shared";
import type { KoseiAnimationScript } from "./kosei-animation-script-generator.js";
import type { KoseiAnimationScenePlan } from "./kosei-animation-scene-planner.js";
import { sceneIndexToken } from "./kosei-animation-paths.js";

export interface BuildKoseiAnimationPlanInput {
  jobId: string;
  script: KoseiAnimationScript;
  scenePlan: KoseiAnimationScenePlan;
  imagesDir: string;
  videosDir: string;
  audioPath: string;
  captions?: CaptionWord[];
  captionSegments?: CaptionSegment[];
}

export function buildKoseiAnimationPlan(
  input: BuildKoseiAnimationPlanInput,
): KoseiAnimationPlan {
  const scenes: KoseiAnimationScene[] = input.scenePlan.scenes.map((s) => {
    const token = sceneIndexToken(s.index);
    return {
      index: s.index,
      narration: s.narration,
      durationSec: s.durationSec,
      visualIntent: s.visualIntent,
      imagePath: path.join(input.imagesDir, `scene-${token}.png`),
      videoPath: path.join(input.videosDir, `scene-${token}.mp4`),
      imagePrompt: s.imagePrompt,
      videoPrompt: s.videoPrompt,
      motionTag: s.motionTag,
      cameraFixed: s.cameraFixed,
    };
  });

  const plan: KoseiAnimationPlan = {
    id: input.jobId,
    topic: input.script.topic,
    era: input.script.era,
    hook: input.script.hook,
    title: input.script.title,
    narration: input.script.narration,
    keyTerms: input.script.keyTerms,
    readings: input.script.readings,
    scenes,
    audioPath: input.audioPath,
    captions: input.captions ?? [],
    captionSegments: input.captionSegments ?? [],
    totalDurationSec: scenes.reduce((sum, s) => sum + s.durationSec, 0),
    createdAt: new Date().toISOString(),
  };

  return KoseiAnimationPlanSchema.parse(plan);
}

export function writeKoseiAnimationPlan(
  plan: KoseiAnimationPlan,
  outPath: string,
): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
}

export function readKoseiAnimationPlan(planPath: string): KoseiAnimationPlan {
  const raw = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  return KoseiAnimationPlanSchema.parse(raw);
}
