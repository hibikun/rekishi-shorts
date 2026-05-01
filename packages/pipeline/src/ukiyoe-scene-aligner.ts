import type { CaptionWord } from "@rekishi/shared";

export interface UkiyoeSceneTiming {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface AlignUkiyoeScenesInput {
  /** Whisper alignment 由来の word 単位タイムスタンプ */
  words: CaptionWord[];
  /** 音声ファイル全体の長さ（最終シーンに自然なテールを残すため最後の終端に採用） */
  totalDurationSec: number;
  /** 各シーンのナレーション本文（順番通り） */
  sceneNarrations: string[];
  /** 最小シーン尺。alignment が壊れて 0 近くになった時のフォールバック下限 */
  minSceneDurationSec?: number;
}

const DEFAULT_MIN_SCENE_DURATION_SEC = 1.5;
const FIRST_SCENE_MAX_LEADING_CHARS = 12;
const ANCHOR_LENGTH = 6;

/**
 * Whisper の word タイムスタンプを使って、各シーンのナレーション末尾位置を求め、
 * シーンごとの実時間 (startSec / endSec / durationSec) を返す。
 *
 * クリップ側カット方針: TTS は固定で、シーン尺をナレーションに合わせて短くする。
 * 最終シーン含め、各シーンの終端 = そのシーンのナレーション最後の語の `endSec`。
 * WAV 末尾の無音は採用しない（余韻でクリップ／字幕が残るのを避けるため）。
 *
 * 整合が取れない場合は等間隔フォールバックを返す（broken-by-guard 等への保険）。
 */
export function alignUkiyoeScenes(input: AlignUkiyoeScenesInput): UkiyoeSceneTiming[] {
  const { words, totalDurationSec, sceneNarrations } = input;
  const minDur = input.minSceneDurationSec ?? DEFAULT_MIN_SCENE_DURATION_SEC;

  if (sceneNarrations.length === 0) return [];

  const fallback = (): UkiyoeSceneTiming[] => {
    const each = totalDurationSec / sceneNarrations.length;
    return sceneNarrations.map((_, i) => ({
      index: i,
      startSec: i * each,
      endSec: (i + 1) * each,
      durationSec: each,
    }));
  };

  if (words.length === 0 || totalDurationSec <= 0) return fallback();

  assertSceneTranscriptOrder(words, sceneNarrations);

  // 各シーンのナレーション末尾の累積文字数（target）を計算
  const targets: number[] = [];
  let acc = 0;
  for (const n of sceneNarrations) {
    acc += n.length;
    targets.push(acc);
  }

  // words を走査して、target に到達した瞬間の word.endSec を採用
  // 注意: new Array(n) はスパース配列になり Array.prototype.some が穴をスキップする。
  // 未到達シーンの検出が漏れると下流で NaN を量産するので必ず undefined を埋める。
  const sceneEndSec: (number | undefined)[] = Array.from({
    length: sceneNarrations.length,
  });
  let charCount = 0;
  let sceneIdx = 0;
  for (const w of words) {
    charCount += w.text.length;
    while (sceneIdx < targets.length) {
      const target = targets[sceneIdx] as number;
      if (charCount < target) break;
      sceneEndSec[sceneIdx] = w.endSec;
      sceneIdx += 1;
    }
    if (sceneIdx >= targets.length) break;
  }

  // 全シーンの境界が確定しなければフォールバック
  if (sceneEndSec.some((v) => v === undefined)) return fallback();

  // 単調増加と最小尺を確保
  const timings: UkiyoeSceneTiming[] = [];
  let prevEnd = 0;
  for (let i = 0; i < sceneNarrations.length; i += 1) {
    const rawEnd = sceneEndSec[i] as number;
    const startSec = prevEnd;
    const endSec = Math.max(rawEnd, startSec + minDur);
    timings.push({
      index: i,
      startSec,
      endSec,
      durationSec: endSec - startSec,
    });
    prevEnd = endSec;
  }

  return timings;
}

export function assertSceneTranscriptOrder(
  words: CaptionWord[],
  sceneNarrations: string[],
): void {
  const transcript = normalizeForOrder(words.map((w) => w.text).join(""));
  const scenes = sceneNarrations.map(normalizeForOrder).filter((s) => s.length > 0);
  if (transcript.length === 0 || scenes.length === 0) return;

  const firstStart = findSceneStart(transcript, scenes[0]!, 0);
  if (firstStart === null) {
    throw new Error(
      "ASR transcript does not follow script order: first scene narration was not found near the beginning. Regenerate TTS or rerun alignment.",
    );
  }
  if (firstStart > FIRST_SCENE_MAX_LEADING_CHARS) {
    throw new Error(
      `ASR transcript does not follow script order: first scene starts after ${firstStart} transcript characters. Regenerate TTS or rerun alignment.`,
    );
  }

  let cursor = firstStart;
  for (let i = 1; i < scenes.length; i += 1) {
    const start = findSceneStart(transcript, scenes[i]!, cursor);
    if (start === null) {
      throw new Error(
        `ASR transcript does not follow script order: scene[${i}] narration was not found after scene[${i - 1}]. Regenerate TTS or rerun alignment.`,
      );
    }
    if (start < cursor) {
      throw new Error(
        `ASR transcript does not follow script order: scene[${i}] appears before the previous scene. Regenerate TTS or rerun alignment.`,
      );
    }
    cursor = start;
  }
}

function findSceneStart(
  transcript: string,
  scene: string,
  fromIndex: number,
): number | null {
  const anchors = buildAnchors(scene);
  let best: number | null = null;
  for (const anchor of anchors) {
    const pos = transcript.indexOf(anchor, fromIndex);
    if (pos === -1) continue;
    if (best === null || pos < best) best = pos;
  }
  return best;
}

function buildAnchors(scene: string): string[] {
  if (scene.length <= ANCHOR_LENGTH) return [scene];
  const anchors: string[] = [];
  for (let i = 0; i <= scene.length - ANCHOR_LENGTH; i += 1) {
    anchors.push(scene.slice(i, i + ANCHOR_LENGTH));
  }
  return anchors;
}

function normalizeForOrder(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[、。！？!?…‥・「」『』（）()［］\[\]【】"'“”‘’\s]/g, "");
}
