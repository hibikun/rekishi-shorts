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
const BOUNDARY_OFFSET_SEC = 0.08;

// scene 句読点タイプ別の「要求する無音の最短長」
const MIN_SILENCE_PERIOD_SEC = 0.20; // 。/！/？: 文末
const MIN_SILENCE_COMMA_SEC = 0.09; // 、: 文中（TTS の息継ぎも通すが、DP が大域最適化で正しい無音を選ぶ）

// DP で「境界をスキップ / 無音を余らせる」ときのコスト（秒単位の距離として加算）
// 3.5s → 期待時刻から 3.5s 以上離れた無音を当てるくらいなら、その境界はスキップする
// TTS は文字数ベース期待から 1〜2s ズレうるので、3.5s は充分な余裕
const SKIP_BOUNDARY_COST = 3.5;

// post-process で「異常に速い/短い scene」を検出して unmatch する
// 日本語 TTS の通常発話速度は 6〜8 cps。8.5 以上は内部 、を scene-end 、と誤認した可能性が高い
const MAX_CPS = 8.5;
const MIN_SCENE_DURATION_SEC = 0.7;

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
 * DP で境界↔無音の大域最適割り当てを求める。
 *
 * 状態: dp[i][j] = 最初 i 個の境界と最初 j 個の無音を処理したときの最小総コスト
 * 遷移:
 *   1. 無音 j をスキップ       : dp[i][j] = dp[i][j-1]
 *   2. 境界 i をスキップ       : dp[i][j] = dp[i-1][j] + SKIP_BOUNDARY_COST
 *   3. 境界 i を無音 j にマッチ : dp[i][j] = dp[i-1][j-1] + |S_j.startSec - E_i|
 *        （無音 j の durationSec が境界 i の kind 最短長を満たす場合のみ）
 *
 * 単調性は DP 構造そのもので保証される（i, j が単調増加）。
 * 期待時刻と実時刻の差の総和を最小化するので、1つの境界で誤マッチしても
 * 他の境界が引きずられにくい（局所的な最適解に陥らない）。
 */
interface BoundaryInfo {
  expectedSec: number;
  kind: BoundaryKind;
}

interface AssignResult {
  /** 各境界に対する無音 index（-1 は未マッチ = 補間対象） */
  silenceIdx: number[];
}

function dpAssignSilencesToBoundaries(
  boundaries: BoundaryInfo[],
  silences: SilenceRegion[],
): AssignResult {
  const N = boundaries.length;
  const M = silences.length;
  const INF = 1e9;

  type Action = "skip-silence" | "skip-boundary" | "match";
  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(INF));
  const act: Action[][] = Array.from({ length: N + 1 }, () => new Array<Action>(M + 1).fill("skip-boundary"));

  // 基底: 境界 0 個の場合、任意の数の無音をスキップしてコスト 0
  for (let j = 0; j <= M; j++) {
    dp[0]![j] = 0;
    act[0]![j] = "skip-silence";
  }

  for (let i = 1; i <= N; i++) {
    const b = boundaries[i - 1]!;
    const minDur = minSilenceFor(b.kind);

    // dp[i][0] = 境界 i をスキップするしかない
    dp[i]![0] = dp[i - 1]![0]! + SKIP_BOUNDARY_COST;
    act[i]![0] = "skip-boundary";

    for (let j = 1; j <= M; j++) {
      const s = silences[j - 1]!;

      // 1. 無音 j をスキップ
      let best = dp[i]![j - 1]!;
      let bestAct: Action = "skip-silence";

      // 2. 境界 i をスキップ
      const costSkipBoundary = dp[i - 1]![j]! + SKIP_BOUNDARY_COST;
      if (costSkipBoundary < best) {
        best = costSkipBoundary;
        bestAct = "skip-boundary";
      }

      // 3. 境界 i を無音 j にマッチ（kind 最短長を満たす場合のみ）
      if (s.durationSec >= minDur) {
        const costMatch = dp[i - 1]![j - 1]! + Math.abs(s.startSec - b.expectedSec);
        if (costMatch < best) {
          best = costMatch;
          bestAct = "match";
        }
      }

      dp[i]![j] = best;
      act[i]![j] = bestAct;
    }
  }

  // backtrack
  const silenceIdx: number[] = new Array(N).fill(-1);
  let i = N;
  let j = M;
  while (i > 0 && j >= 0) {
    const action = act[i]![j]!;
    if (action === "match") {
      silenceIdx[i - 1] = j - 1;
      i--;
      j--;
    } else if (action === "skip-silence") {
      if (j === 0) break;
      j--;
    } else {
      // skip-boundary
      i--;
    }
  }

  return { silenceIdx };
}

/**
 * scenes + silences から、scenes.length 個の境界（= 各 scene の endSec）を決定する。
 * 最終要素は必ず totalDurationSec。
 *
 * Algorithm:
 *   1. 文字数ベースの期待時刻を計算
 *   2. DP で境界×無音の最適割り当て
 *   3. 単調性を後処理で保証（DP は単調だが、割り当て済み境界が前の補間より前に来た場合のケア）
 *   4. 未マッチ境界は前後の既知境界で線形補間
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
  const boundaries: BoundaryInfo[] = expected.map((expectedSec, i) => ({
    expectedSec,
    kind: classifyBoundary(scenes[i]!.narration),
  }));

  const { silenceIdx } = dpAssignSilencesToBoundaries(boundaries, silences);

  // 各境界に対してマッチした無音から実時刻を算出
  const matched: (number | null)[] = silenceIdx.map((idx) => {
    if (idx < 0) return null;
    const s = silences[idx]!;
    return Math.min(s.endSec - 0.01, s.startSec + BOUNDARY_OFFSET_SEC);
  });

  // post-process: DP が近接する無音 2 つを連続境界に割り当てたり、
  // 内部 、 を scene-end 、 と誤認した結果、極端に短い/速い scene を生むことがある。
  // 発話速度 > MAX_CPS または duration < MIN_SCENE_DURATION なら unmatch し、補間に委ねる。
  rejectImplausibleMatches(matched, scenes, totalDurationSec);

  // 単調性を後処理で保証 + 未マッチは「文字数重み」で前後の既知境界から補間する
  const finalBoundaries: SceneBoundary[] = [];
  let prevEnd = 0;
  let matchedCount = 0;
  const normalizedChars = scenes.map((s) => normalizeForLength(s.narration).length || 1);
  for (let i = 0; i < n - 1; i++) {
    const picked = matched[i] ?? null;
    if (picked !== null && picked > prevEnd + 0.05) {
      finalBoundaries.push({ endSec: Number(picked.toFixed(3)), fromVad: true });
      prevEnd = picked;
      matchedCount++;
    } else {
      // 次に matched な境界 nextMatchedIdx を探す。なければ totalDurationSec までを gap とする。
      const nextMatchedIdx = findNextMatched(matched, i);
      const nextSec = nextMatchedIdx !== null ? (matched[nextMatchedIdx] ?? totalDurationSec) : totalDurationSec;
      // gap の中に収まる scene は [i .. lastSceneIdx]:
      //   - nextMatchedIdx が matched なら、その境界は scene nextMatchedIdx の END なので
      //     scene nextMatchedIdx までが gap に含まれる。
      //   - 末尾（マッチなし）なら gap は最後の scene (n-1) まで含む。
      const lastSceneIdx = nextMatchedIdx !== null ? nextMatchedIdx : n - 1;
      let charsInGap = 0;
      for (let k = i; k <= lastSceneIdx; k++) charsInGap += normalizedChars[k]!;
      const thisChars = normalizedChars[i]!;
      const gap = nextSec - prevEnd;
      const interp = prevEnd + (thisChars / charsInGap) * gap;
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

/**
 * マッチ結果をチェックし、発話速度が高すぎるか尺が短すぎる scene は unmatch する。
 * DP のコスト関数は絶対時間距離のみを見るので、近接無音への過剰割当を発見的に弾く。
 * 2 連続 scene が問題の場合は、期待時刻から遠い方を優先的に unmatch する（単純ヒューリスティック）。
 */
function rejectImplausibleMatches(
  matched: (number | null)[],
  scenes: Scene[],
  totalDurationSec: number,
): void {
  const n = scenes.length;
  const getPrevEnd = (i: number): number => {
    for (let k = i - 1; k >= 0; k--) {
      const m = matched[k];
      if (m !== null && m !== undefined) return m;
    }
    return 0;
  };
  const getNextEnd = (i: number): number => {
    for (let k = i + 1; k < n - 1; k++) {
      const m = matched[k];
      if (m !== null && m !== undefined) return m;
    }
    return totalDurationSec;
  };

  // 複数パスで安定化（1つ unmatch で隣の scene の duration が変わるため）
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < n - 1; i++) {
      const m = matched[i];
      if (m === null || m === undefined) continue;
      const prevEnd = getPrevEnd(i);
      const dur = m - prevEnd;
      const chars = normalizeForLength(scenes[i]!.narration).length || 1;
      const cps = chars / Math.max(0.001, dur);
      if (dur < MIN_SCENE_DURATION_SEC || cps > MAX_CPS) {
        matched[i] = null;
        changed = true;
      }
    }
    // 次 scene 側もチェック: scene i+1 が短すぎるなら scene i を unmatch する方が筋が良い
    for (let i = 0; i < n - 2; i++) {
      const m = matched[i];
      const mNext = matched[i + 1];
      if (m === null || m === undefined || mNext === null || mNext === undefined) continue;
      const nextDur = mNext - m;
      const nextChars = normalizeForLength(scenes[i + 1]!.narration).length || 1;
      const nextCps = nextChars / Math.max(0.001, nextDur);
      if (nextDur < MIN_SCENE_DURATION_SEC || nextCps > MAX_CPS) {
        matched[i] = null;
        changed = true;
      }
    }
    if (!changed) break;
  }
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
