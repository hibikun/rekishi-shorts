import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import { promptPath } from "@rekishi/shared/channel";
import { config } from "./config.js";
import type { UkiyoeActionTag } from "./ukiyoe-video-generator.js";
import type { UkiyoeScript } from "./ukiyoe-script-generator.js";

export interface UkiyoeSceneSpec {
  index: number;
  narration: string;
  durationSec: number;
  /** 静止画生成プロンプト（英語） */
  imagePrompt: string;
  /** 動画生成プロンプト（英語、動作描写） */
  videoPrompt: string;
  actionTag: UkiyoeActionTag;
  cameraFixed?: boolean;
}

export interface UkiyoeScenePlan {
  topic: string;
  totalDurationSec: number;
  scenes: UkiyoeSceneSpec[];
}

export interface UkiyoeScenePlanResult {
  plan: UkiyoeScenePlan;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

const ACTION_TAGS: UkiyoeActionTag[] = [
  "running_forward",
  "eating_meal",
  "drawing_sword",
  "walking_carrying",
  "sleeping",
  "crowd_cheering",
  "weather_dynamic",
  "still_subtle",
];

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
          imagePrompt: { type: Type.STRING },
          videoPrompt: { type: Type.STRING },
          actionTag: { type: Type.STRING, enum: ACTION_TAGS as unknown as string[] },
          cameraFixed: { type: Type.BOOLEAN },
        },
        required: [
          "index",
          "narration",
          "durationSec",
          "imagePrompt",
          "videoPrompt",
          "actionTag",
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
  const tpl = fs.readFileSync(promptPath("scene-plan-routine", "ukiyoe"), "utf-8");
  return tpl
    .replace(/\{\{topic\}\}/g, args.topic)
    .replace(/\{\{narration\}\}/g, args.narration)
    .replace(/\{\{target_scene_count\}\}/g, String(args.targetSceneCount))
    .replace(/\{\{target_duration_sec\}\}/g, String(args.targetDurationSec));
}

export async function planUkiyoeScenes(
  script: UkiyoeScript,
): Promise<UkiyoeScenePlanResult> {
  const targetSceneCount = script.targetSceneCount;
  const targetDurationSec = targetSceneCount * 5;

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderPrompt({
    topic: script.topic,
    narration: script.narration,
    targetSceneCount,
    targetDurationSec,
  });

  const response = await ai.models.generateContent({
    model: config.gemini.sceneModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.4,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty ukiyoe scene plan response");

  const raw = JSON.parse(text) as {
    topic?: string;
    totalDurationSec?: number;
    scenes: Array<{
      index: number;
      narration: string;
      durationSec: number;
      imagePrompt: string;
      videoPrompt: string;
      actionTag: string;
      cameraFixed?: boolean;
    }>;
  };

  // 動勢タグの妥当性チェック
  const tagSet = new Set<string>(ACTION_TAGS);
  const scenes: UkiyoeSceneSpec[] = raw.scenes.map((s) => {
    if (!tagSet.has(s.actionTag)) {
      throw new Error(
        `Invalid actionTag in scene[${s.index}]: ${s.actionTag} (allowed: ${ACTION_TAGS.join(", ")})`,
      );
    }
    return {
      index: s.index,
      narration: s.narration,
      durationSec: s.durationSec,
      imagePrompt: s.imagePrompt,
      videoPrompt: s.videoPrompt,
      actionTag: s.actionTag as UkiyoeActionTag,
      cameraFixed: s.cameraFixed,
    };
  });

  if (scenes.length !== targetSceneCount) {
    throw new Error(
      `scene-planner returned ${scenes.length} scenes; expected ${targetSceneCount} (topic=${script.topic})`,
    );
  }

  const plan: UkiyoeScenePlan = {
    topic: raw.topic ?? script.topic,
    totalDurationSec: raw.totalDurationSec ?? targetDurationSec,
    scenes,
  };

  return {
    plan,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: config.gemini.sceneModel,
    },
  };
}
