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

  // 元 narration を改変・水増ししていないか検証する。
  // 句読点・空白・括弧などの装飾差は無視して比較。
  assertNarrationFidelity(script.narration, scenes);

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

/**
 * 句読点・空白・括弧・記号を取り除いて比較用に正規化する。
 * Gemini が「夜の十時」→「夜十時」のような微差を出すこともあるが、
 * ほとんどのケースは句読点や装飾の差なのでここでは記号類だけ落とす。
 */
function normalizeForCompare(s: string): string {
  return s
    .replace(/[\s　、。．，「」『』（）()！？!?・…—\-]/g, "")
    .trim();
}

/**
 * scene-planner が元 narration を改変・水増しせず分割しているかを検証する。
 *
 * 検出する代表的な違反:
 *   - 元になかった装飾文の追加（例: 「夜の帳が降りる」「驚愕の事実」）
 *   - 行動の捏造（例: 入力に「竹光」しかないのに「竹光を抜き放ち命を懸ける」）
 *   - 締めの差し替え（最終シーンが元の最終文と全く別の感想文になる）
 *
 * チェック方法は2段階:
 *   1) 各シーン narration が元 narration の連続部分文字列か（部分一致）
 *   2) 全シーン連結が元 narration とおおむね一致するか（被覆 95%+）
 *
 * 違反を検出した場合は人間が直すか再生成するかを判断できるように、
 * 詳細を載せた Error を投げる。
 */
function assertNarrationFidelity(
  sourceNarration: string,
  scenes: UkiyoeSceneSpec[],
): void {
  const sourceNorm = normalizeForCompare(sourceNarration);
  if (!sourceNorm) return;

  const violations: string[] = [];
  for (const s of scenes) {
    const sceneNorm = normalizeForCompare(s.narration);
    if (!sceneNorm) continue;
    if (!sourceNorm.includes(sceneNorm)) {
      violations.push(
        `scene[${s.index}] narration が元に存在しない: "${s.narration}"`,
      );
    }
  }

  const concatNorm = scenes
    .map((s) => normalizeForCompare(s.narration))
    .join("");
  // 被覆: 連結結果が元 narration の 95% 以上をカバーしていること
  // （改変なし分割なら 100% 一致するはず）
  const coverageRatio =
    sourceNorm.length === 0 ? 1 : concatNorm.length / sourceNorm.length;
  if (coverageRatio < 0.95 || coverageRatio > 1.05) {
    violations.push(
      `全シーン連結の文字数が元 narration と乖離: source=${sourceNorm.length} chars, concat=${concatNorm.length} chars (ratio=${coverageRatio.toFixed(2)})`,
    );
  }

  if (violations.length > 0) {
    throw new Error(
      [
        "scene-planner が元 narration を改変・水増しした疑いがあります。",
        "プロンプト（scene-plan-routine.md）の「ナレーション分割の絶対ルール」を確認するか、再生成してください。",
        "",
        "違反:",
        ...violations.map((v) => `  - ${v}`),
        "",
        `元 narration: ${sourceNarration}`,
      ].join("\n"),
    );
  }
}
