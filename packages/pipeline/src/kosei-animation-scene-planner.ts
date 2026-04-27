import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";
import type { KoseiAnimationMotionTag } from "@rekishi/shared";
import type { KoseiAnimationScript } from "./kosei-animation-script-generator.js";

export interface KoseiAnimationSceneSpec {
  index: number;
  narration: string;
  durationSec: number;
  visualIntent: string;
  imagePrompt: string;
  videoPrompt: string;
  motionTag: KoseiAnimationMotionTag;
  cameraFixed?: boolean;
}

export interface KoseiAnimationScenePlan {
  topic: string;
  totalDurationSec: number;
  scenes: KoseiAnimationSceneSpec[];
}

export interface KoseiAnimationScenePlanResult {
  plan: KoseiAnimationScenePlan;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

const MOTION_TAGS = [
  "breathing_idle",
  "subtle_head_turn",
  "slow_walk",
  "mouth_open_close",
  "feeding_motion",
  "tail_body_motion",
  "environment_motion",
  "fossil_camera_push",
  "detail_camera_push",
  "still_subtle",
] as const satisfies readonly KoseiAnimationMotionTag[];

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    topic: { type: Type.STRING },
    totalDurationSec: { type: Type.NUMBER },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.NUMBER },
          narration: { type: Type.STRING },
          durationSec: { type: Type.NUMBER },
          visualIntent: { type: Type.STRING },
          imagePrompt: { type: Type.STRING },
          videoPrompt: { type: Type.STRING },
          motionTag: { type: Type.STRING, enum: MOTION_TAGS as unknown as string[] },
          cameraFixed: { type: Type.BOOLEAN },
        },
        required: [
          "index",
          "narration",
          "durationSec",
          "visualIntent",
          "imagePrompt",
          "videoPrompt",
          "motionTag",
        ],
      },
    },
  },
  required: ["scenes"],
};

function renderPrompt(args: {
  topic: string;
  narration: string;
  targetSceneCount: number;
  targetDurationSec: number;
}): string {
  const tpl = fs.readFileSync(
    promptPath("scene-plan-routine", "kosei-animation"),
    "utf-8",
  );
  return tpl
    .replace(/\{\{topic\}\}/g, args.topic)
    .replace(/\{\{narration\}\}/g, args.narration)
    .replace(/\{\{target_scene_count\}\}/g, String(args.targetSceneCount))
    .replace(/\{\{target_duration_sec\}\}/g, String(args.targetDurationSec));
}

export async function planKoseiAnimationScenes(
  script: KoseiAnimationScript,
): Promise<KoseiAnimationScenePlanResult> {
  const targetSceneCount = script.targetSceneCount;
  const targetDurationSec = targetSceneCount * 5;
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const response = await ai.models.generateContent({
    model: config.gemini.sceneModel,
    contents: renderPrompt({
      topic: script.topic,
      narration: script.narration,
      targetSceneCount,
      targetDurationSec,
    }),
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.35,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty kosei-animation scene plan response");
  const raw = JSON.parse(text) as {
    topic?: string;
    totalDurationSec?: number;
    scenes: Array<{
      index: number;
      narration: string;
      durationSec: number;
      visualIntent: string;
      imagePrompt: string;
      videoPrompt: string;
      motionTag: string;
      cameraFixed?: boolean;
    }>;
  };

  const tagSet = new Set<string>(MOTION_TAGS);
  const scenes = raw.scenes.map((s) => {
    if (!tagSet.has(s.motionTag)) {
      throw new Error(
        `Invalid motionTag in scene[${s.index}]: ${s.motionTag} (allowed: ${MOTION_TAGS.join(", ")})`,
      );
    }
    return {
      index: s.index,
      narration: s.narration,
      durationSec: s.durationSec,
      visualIntent: s.visualIntent,
      imagePrompt: s.imagePrompt,
      videoPrompt: s.videoPrompt,
      motionTag: s.motionTag as KoseiAnimationMotionTag,
      cameraFixed: s.cameraFixed,
    };
  });

  if (scenes.length !== targetSceneCount) {
    throw new Error(
      `scene-planner returned ${scenes.length} scenes; expected ${targetSceneCount} (topic=${script.topic})`,
    );
  }

  return {
    plan: {
      topic: raw.topic ?? script.topic,
      totalDurationSec: raw.totalDurationSec ?? targetDurationSec,
      scenes,
    },
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.sceneModel,
    },
  };
}
