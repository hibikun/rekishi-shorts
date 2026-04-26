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

/**
 * Whisper の word タイムスタンプを使って、各シーンのナレーション末尾位置を求め、
 * シーンごとの実時間 (startSec / endSec / durationSec) を返す。
 *
 * クリップ側カット方針: TTS は固定で、シーン尺をナレーションに合わせて短くする。
 * - 各シーンの終端 = そのシーンのナレーション最後の語の `endSec`
 * - 最終シーンの終端だけ `totalDurationSec` に揃える（WAV 末尾の自然な無音/余韻を保持）
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

  // 各シーンのナレーション末尾の累積文字数（target）を計算
  const targets: number[] = [];
  let acc = 0;
  for (const n of sceneNarrations) {
    acc += n.length;
    targets.push(acc);
  }

  // words を走査して、target に到達した瞬間の word.endSec を採用
  const sceneEndSec: (number | undefined)[] = new Array(sceneNarrations.length);
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

  // 最終シーンの終端は WAV 全体長に揃える（自然なテールを残す）
  sceneEndSec[sceneEndSec.length - 1] = totalDurationSec;

  // 単調増加と最小尺を確保
  const timings: UkiyoeSceneTiming[] = [];
  let prevEnd = 0;
  for (let i = 0; i < sceneNarrations.length; i += 1) {
    const rawEnd = sceneEndSec[i] as number;
    const startSec = prevEnd;
    let endSec = Math.max(rawEnd, startSec + minDur);
    if (i === sceneNarrations.length - 1) {
      endSec = Math.max(totalDurationSec, startSec + minDur);
    }
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
