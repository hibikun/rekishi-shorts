import type { CaptionSegment, CaptionWord } from "@rekishi/shared";
import type {
  KoseiAnimationScenePlan,
  KoseiAnimationSceneSpec,
} from "./kosei-animation-scene-planner.js";
import { alignScenesToAudio } from "./scene-aligner.js";

export interface KoseiAnimationSceneAlignment {
  scenePlan: KoseiAnimationScenePlan;
  captionSegments: CaptionSegment[];
}

export function alignKoseiAnimationScenes(args: {
  scenePlan: KoseiAnimationScenePlan;
  words: CaptionWord[];
  totalDurationSec: number;
  audioPath: string;
  brokenAsr?: boolean;
}): KoseiAnimationSceneAlignment {
  const genericScenes = args.scenePlan.scenes.map((s) => ({
    index: s.index,
    narration: s.narration,
    imageQueryJa: args.scenePlan.topic,
    imageQueryEn: s.visualIntent,
    imagePromptEn: s.imagePrompt,
    durationSec: s.durationSec,
  }));

  const alignment = alignScenesToAudio(genericScenes, args.words, args.totalDurationSec, {
    audioPath: args.audioPath,
    brokenAsr: args.brokenAsr,
  });

  const durationByIndex = new Map(
    alignment.scenes.map((s) => [s.index, s.durationSec] as const),
  );
  const scenes: KoseiAnimationSceneSpec[] = args.scenePlan.scenes.map((s) => ({
    ...s,
    durationSec: durationByIndex.get(s.index) ?? s.durationSec,
  }));

  return {
    scenePlan: {
      ...args.scenePlan,
      totalDurationSec: scenes.reduce((sum, s) => sum + s.durationSec, 0),
      scenes,
    },
    captionSegments: alignment.captionSegments,
  };
}
