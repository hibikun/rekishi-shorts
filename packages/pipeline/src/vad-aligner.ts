import fs from "node:fs";
import type { Scene } from "@rekishi/shared";

/**
 * VADベースのシーン境界推定
 *
 * Whisper が破綻した際の堅牢なフォールバック。
 * WAV の無音区間から、scenes の句読点に合う境界時刻を決定する。
 *
 * Codex レビュー反映:
 * - RIFF chunk を走査して fmt/data を見つける（44byte 固定前提にしない）
 * - 閾値は絶対値ではなく dBFS percentile ベース
 * - 貪欲マッチではなく「期待累積時刻 ± 窓」で近接マッチ
 * - 境界は silence end ではなく silence start + 50ms
 * - 最終 scene 末は境界ではない（scenes.length - 1 固定）
 */

export interface WavData {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

export interface SilenceRegion {
  startSec: number;
  endSec: number;
  durationSec: number;
  meanDb: number; // 無音区間の平均音量 dBFS
}

export interface SceneBoundary {
  /** この scene の発話終了時刻（次 scene の開始時刻と一致） */
  endSec: number;
  /** この境界が VAD で検出されたか（false なら補間） */
  fromVad: boolean;
}

export interface VadAlignmentResult {
  /** 各 scene の endSec。長さは scenes.length、最終要素は totalDurationSec */
  boundaries: SceneBoundary[];
  silencesFound: number;
  matchedCount: number;
}

const FRAME_SEC = 0.02; // 20ms window
const HOP_SEC = 0.01; // 10ms hop

// 無音と判定する最小持続時間
const MIN_SILENCE_SEC = 0.08;

// 境界位置を silence 先頭からどれくらい遅らせるか
const BOUNDARY_OFFSET_SEC = 0.05;

// scene 句読点タイプ別の「要求する無音の最短長」
const MIN_SILENCE_PERIOD_SEC = 0.22; // 。/！/？: 文末
const MIN_SILENCE_COMMA_SEC = 0.09; // 、: 文中

// 期待時刻からどれだけ離れた silence まで候補にするか
const SEARCH_WINDOW_SEC = 1.0;

// =================== WAV パーサ ===================

/**
 * RIFF WAV を読み、mono 化した float32 サンプルを返す。
 * 44byte 固定前提にせず、chunk を走査する（LIST chunk などが入っていても対応）。
 * 16bit PCM のみサポート（TTS 出力が 24kHz mono 16bit のため）。
 */
export function readWav(path: string): WavData {
  const buf = fs.readFileSync(path);
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`not a RIFF/WAVE file: ${path}`);
  }

  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number; audioFormat: number } | null = null;
  let pcm: Buffer | null = null;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(chunkDataStart),
        channels: buf.readUInt16LE(chunkDataStart + 2),
        sampleRate: buf.readUInt32LE(chunkDataStart + 4),
        bitsPerSample: buf.readUInt16LE(chunkDataStart + 14),
      };
    } else if (chunkId === "data") {
      pcm = buf.subarray(chunkDataStart, chunkDataStart + chunkSize);
    }
    // chunk は偶数境界に padding される
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
    if (fmt && pcm) break;
  }

  if (!fmt) throw new Error("fmt chunk not found");
  if (!pcm) throw new Error("data chunk not found");
  if (fmt.audioFormat !== 1) throw new Error(`unsupported audio format: ${fmt.audioFormat} (only PCM is supported)`);
  if (fmt.bitsPerSample !== 16) throw new Error(`unsupported bits per sample: ${fmt.bitsPerSample} (only 16bit is supported)`);

  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameSize = bytesPerSample * fmt.channels;
  const frameCount = Math.floor(pcm.length / frameSize);
  const samples = new Float32Array(frameCount);

  // 複数チャネルは平均化して mono 化
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      sum += pcm.readInt16LE(i * frameSize + c * bytesPerSample);
    }
    samples[i] = sum / fmt.channels / 32768;
  }

  return { samples, sampleRate: fmt.sampleRate, channels: fmt.channels };
}

// =================== 無音検出 ===================

/**
 * フレーム単位の RMS を dBFS で返す（20ms window / 10ms hop）。
 */
export function computeFrameRmsDb(wav: WavData): { dbValues: Float32Array; hopSec: number } {
  const { samples, sampleRate } = wav;
  const frameLen = Math.round(FRAME_SEC * sampleRate);
  const hopLen = Math.round(HOP_SEC * sampleRate);
  const frameCount = Math.max(0, Math.floor((samples.length - frameLen) / hopLen) + 1);
  const out = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const start = i * hopLen;
    let sumSq = 0;
    for (let j = 0; j < frameLen; j++) {
      const s = samples[start + j] ?? 0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / frameLen);
    // floor to avoid -Infinity
    out[i] = rms > 0 ? 20 * Math.log10(rms) : -120;
  }
  return { dbValues: out, hopSec: HOP_SEC };
}

/**
 * percentile ベースの動的閾値を計算する。
 * noise (p10) と speech (p90) の間に閾値を置く。
 * clamp で極端値を回避。
 */
export function computeSilenceThresholdDb(dbValues: Float32Array): number {
  const sorted = Array.from(dbValues).sort((a, b) => a - b);
  if (sorted.length === 0) return -45;
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? -60;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? -20;
  // noise + 0.3 * (speech - noise)
  const raw = p10 + 0.3 * (p90 - p10);
  // 実用範囲で clamp
  return Math.max(-55, Math.min(-35, raw));
}

/**
 * 閾値以下が MIN_SILENCE_SEC 以上続く区間を無音として抽出する。
 * 30ms 以下で分断された低 RMS 区間は merge する。
 */
export function detectSilences(wav: WavData): SilenceRegion[] {
  const { dbValues, hopSec } = computeFrameRmsDb(wav);
  const threshold = computeSilenceThresholdDb(dbValues);
  const minSilenceFrames = Math.ceil(MIN_SILENCE_SEC / hopSec);
  const mergeGapFrames = Math.ceil(0.03 / hopSec);

  // まず low frames を連続区間として粗く集める
  const rawRegions: { startFrame: number; endFrame: number }[] = [];
  let runStart = -1;
  for (let i = 0; i < dbValues.length; i++) {
    const isLow = (dbValues[i] ?? 0) <= threshold;
    if (isLow && runStart === -1) {
      runStart = i;
    } else if (!isLow && runStart !== -1) {
      rawRegions.push({ startFrame: runStart, endFrame: i - 1 });
      runStart = -1;
    }
  }
  if (runStart !== -1) rawRegions.push({ startFrame: runStart, endFrame: dbValues.length - 1 });

  // 近接する区間を merge
  const merged: { startFrame: number; endFrame: number }[] = [];
  for (const r of rawRegions) {
    const prev = merged[merged.length - 1];
    if (prev && r.startFrame - prev.endFrame <= mergeGapFrames) {
      prev.endFrame = r.endFrame;
    } else {
      merged.push({ ...r });
    }
  }

  // 最短長でフィルタし、平均 dB を付けて返す
  const out: SilenceRegion[] = [];
  for (const r of merged) {
    const frameCount = r.endFrame - r.startFrame + 1;
    if (frameCount < minSilenceFrames) continue;
    let sum = 0;
    for (let i = r.startFrame; i <= r.endFrame; i++) sum += dbValues[i] ?? 0;
    const meanDb = sum / frameCount;
    const startSec = r.startFrame * hopSec;
    const endSec = (r.endFrame + 1) * hopSec;
    out.push({
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      durationSec: Number((endSec - startSec).toFixed(3)),
      meanDb: Number(meanDb.toFixed(1)),
    });
  }
  return out;
}

// =================== scene 境界マッチング ===================

type BoundaryKind = "period" | "comma";

function classifyBoundary(sceneNarration: string): BoundaryKind {
  const last = sceneNarration.slice(-1);
  if (last === "。" || last === "！" || last === "？" || last === "!" || last === "?") return "period";
  return "comma";
}

function minSilenceFor(kind: BoundaryKind): number {
  return kind === "period" ? MIN_SILENCE_PERIOD_SEC : MIN_SILENCE_COMMA_SEC;
}

/**
 * 文字数ベースで各 scene 境界の期待累積時刻を算出する。
 * scene.narration の正規化文字数を積み上げ、合計で割って totalDurationSec に比例配分。
 */
function computeExpectedBoundaries(scenes: Scene[], totalDurationSec: number): number[] {
  const charCounts = scenes.map((s) => normalizeForLength(s.narration).length || 1);
  const total = charCounts.reduce((a, b) => a + b, 0);
  const result: number[] = [];
  let acc = 0;
  for (let i = 0; i < scenes.length - 1; i++) {
    acc += charCounts[i]!;
    result.push((acc / total) * totalDurationSec);
  }
  return result;
}

function normalizeForLength(s: string): string {
  // 正規化はシンプルに、空白と句読点だけ除く
  return s.replace(/[\s、。！？!?「」『』\[\]（）()]/g, "");
}

/**
 * 期待時刻の近傍で最適な silence を選ぶ。
 *
 * 評価基準: 最短長を満たす silence のうち、期待時刻との時間距離が近いものを選ぶ。
 * 候補が窓内に無ければ null（補間にまわす）。
 */
function pickSilenceForBoundary(
  silences: SilenceRegion[],
  expectedSec: number,
  kind: BoundaryKind,
  usedIndices: Set<number>,
  earliestSec: number,
): { index: number; boundarySec: number } | null {
  const minLen = minSilenceFor(kind);
  let bestIdx = -1;
  let bestDist = SEARCH_WINDOW_SEC + 1;
  for (let i = 0; i < silences.length; i++) {
    if (usedIndices.has(i)) continue;
    const s = silences[i]!;
    if (s.durationSec < minLen) continue;
    // 単調性: 直前の境界より後ろ（少なくとも marginSec 以上先）
    if (s.startSec < earliestSec) continue;
    const dist = Math.abs(s.startSec - expectedSec);
    if (dist > SEARCH_WINDOW_SEC) continue;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return null;
  const chosen = silences[bestIdx]!;
  return {
    index: bestIdx,
    boundarySec: Math.min(
      chosen.endSec - 0.01,
      chosen.startSec + BOUNDARY_OFFSET_SEC,
    ),
  };
}

/**
 * scenes + silences から、scenes.length 個の境界（= 各 scene の endSec）を決定する。
 * 最終要素は必ず totalDurationSec。
 */
export function matchScenesToSilences(
  scenes: Scene[],
  silences: SilenceRegion[],
  totalDurationSec: number,
): VadAlignmentResult {
  const n = scenes.length;
  if (n === 0) {
    return { boundaries: [], silencesFound: silences.length, matchedCount: 0 };
  }

  const expected = computeExpectedBoundaries(scenes, totalDurationSec);
  const usedIndices = new Set<number>();
  const matched: (number | null)[] = new Array(n - 1).fill(null);
  let earliestSec = 0;

  // 1pass: period を優先してマッチ（無音が強く、誤マッチしにくい）
  const order = [
    ...Array.from({ length: n - 1 }, (_, i) => ({ i, kind: classifyBoundary(scenes[i]!.narration) })),
  ];
  const periodFirst = [...order].sort((a, b) => {
    if (a.kind === b.kind) return a.i - b.i;
    return a.kind === "period" ? -1 : 1;
  });

  for (const { i, kind } of periodFirst) {
    const pick = pickSilenceForBoundary(silences, expected[i]!, kind, usedIndices, earliestSec);
    if (pick) {
      matched[i] = pick.boundarySec;
      usedIndices.add(pick.index);
    }
  }

  // 単調性を整えるため index 順に並べ直し、逆戻りや隙間を埋める
  const finalBoundaries: SceneBoundary[] = [];
  let prevEnd = 0;
  let matchedCount = 0;
  for (let i = 0; i < n - 1; i++) {
    const picked = matched[i] ?? null;
    if (picked !== null && picked > prevEnd + 0.05) {
      finalBoundaries.push({ endSec: Number(picked.toFixed(3)), fromVad: true });
      prevEnd = picked;
      matchedCount++;
    } else {
      // 補間: 期待時刻と前後の既知境界を使う
      const nextMatched = findNextMatched(matched, i);
      const nextSec = nextMatched !== null ? (matched[nextMatched] ?? totalDurationSec) : totalDurationSec;
      const gap = nextMatched !== null ? nextMatched - i + 1 : n - i;
      const interp = prevEnd + (nextSec - prevEnd) / gap;
      finalBoundaries.push({ endSec: Number(interp.toFixed(3)), fromVad: false });
      prevEnd = interp;
    }
  }
  // 最終 scene end = totalDuration
  finalBoundaries.push({ endSec: Number(totalDurationSec.toFixed(3)), fromVad: false });

  return {
    boundaries: finalBoundaries,
    silencesFound: silences.length,
    matchedCount,
  };
}

function findNextMatched(matched: (number | null)[], from: number): number | null {
  for (let j = from + 1; j < matched.length; j++) {
    if (matched[j] !== null) return j;
  }
  return null;
}

// =================== トップレベル ===================

export interface VadOptions {
  scenes: Scene[];
  audioPath: string;
  totalDurationSec: number;
}

/**
 * VAD アライメントの全体フロー。
 * 1. WAV を読む
 * 2. 無音区間を検出
 * 3. 期待時刻ベースで scene 境界にマッチ
 *
 * 失敗（無音ゼロなど）したら null を返す。呼び出し元は線形配分などにフォールバック。
 */
export function alignScenesByVad(opts: VadOptions): VadAlignmentResult | null {
  const { scenes, audioPath, totalDurationSec } = opts;
  if (scenes.length === 0) return null;

  let wav: WavData;
  try {
    wav = readWav(audioPath);
  } catch {
    return null;
  }
  const silences = detectSilences(wav);
  if (silences.length === 0) return null;

  return matchScenesToSilences(scenes, silences, totalDurationSec);
}
