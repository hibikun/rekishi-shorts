import type { CaptionSegment, CaptionWord, Scene } from "@rekishi/shared";

/**
 * Whisper の word タイムスタンプに対して、Gemini 由来の scenes を単調アラインする。
 *
 * - 両方の文字列を normalize (NFKC / 句読点/空白/引用符/括弧除去 / 全角数字→半角) して
 *   Whisper words を連結した「文字 stream + 各文字 → word index」を作る
 * - scenes を前から順に走査し、各 scene の normalize 済み narration を char stream の
 *   現在位置以降から単調消費する
 *   - 一致しない場合は字数単位でずれを吸収しつつ前進（fuzzy 許容の簡易版）
 * - 各 scene の境界は「最後にマッチした word.endSec」、次 scene の開始は「最初にマッチした word.startSec」
 * - すべての scene がマッチしなかった場合は線形スケールにフォールバックし警告を返す
 *
 * 返り値:
 * - scenes: durationSec を実発話由来で上書きした Scene[]（合計は totalDurationSec 相当）
 * - captionSegments: 画面 scene duration ではなく「発話区間」に合わせた字幕セグメント
 */
export interface AlignmentResult {
  scenes: Scene[];
  captionSegments: CaptionSegment[];
  fallbackUsed: boolean;
}

// bounded window: exact / anchor / LCS の全マッチャが共通で使う探索幅
const WINDOW_MIN_CHARS = 32;
const WINDOW_SCENE_MULTIPLIER = 2.5;
const WINDOW_EXTRA_PAD = 8;

// LCS 採否ゲート: 疎な一致で広い span を拾うのを防ぐ
const LCS_CONFIDENCE_THRESHOLD = 0.6;
const LCS_SPAN_EXPANSION = 2.5;
const LCS_SPAN_EXTRA = 8;

// 次 scene の発話開始直前まで現 scene を延長するときのマージン
const BOUNDARY_EPSILON_SEC = 0.03;

export function alignScenesToAudio(
  scenes: Scene[],
  words: CaptionWord[],
  totalDurationSec: number,
): AlignmentResult {
  if (scenes.length === 0 || words.length === 0) {
    return {
      scenes,
      captionSegments: [],
      fallbackUsed: scenes.length > 0,
    };
  }

  const { charStream, charWordIndex } = buildCharStream(words);
  if (charStream.length === 0) {
    return fallbackLinear(scenes, totalDurationSec);
  }

  type Span = { firstWordIdx: number; lastWordIdx: number };
  const spans: (Span | null)[] = [];

  let streamPos = 0;
  for (const scene of scenes) {
    const normalizedScene = normalize(scene.narration);
    if (normalizedScene.length === 0) {
      spans.push(null);
      continue;
    }

    const span = consumeScene(charStream, charWordIndex, streamPos, normalizedScene);
    if (span === null) {
      spans.push(null);
      continue;
    }
    spans.push(span);
    streamPos = Math.max(streamPos, charPosAfter(span, charWordIndex) + 0);
  }

  const matchCount = spans.filter((s): s is Span => s !== null).length;
  if (matchCount === 0) {
    return fallbackLinear(scenes, totalDurationSec);
  }

  // 欠損 scene は前後のマッチ span の間を等分して埋める
  const filledSpans = fillMissingSpans(spans, words.length);

  const alignedScenes: Scene[] = [];
  const captionSegments: CaptionSegment[] = [];
  const lastWordFallback = words[words.length - 1]!;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const span = filledSpans[i]!;
    const lastWord = words[span.lastWordIdx] ?? lastWordFallback;

    // scene 境界: 前 scene の終端を開始とし、次 scene 先頭 word の直前までこの scene を延ばす。
    // - 冒頭: 前 scene の lastWord.endSec（初回は 0）から字幕を出し、ASR が取りこぼした mora も埋める。
    // - 末尾: 中間 scene は「次 scene の firstWord.startSec - ε」まで、最終 scene は totalDurationSec まで。
    // durationSec(映像側) と captionEnd(字幕側) を同じ boundaryEnd に揃え、映像と字幕のズレを防ぐ。
    const prevEnd = alignedScenes.at(-1)
      ? alignedScenes.reduce((acc, s) => acc + s.durationSec, 0)
      : 0;
    const isLast = i === scenes.length - 1;
    const sceneEnd = lastWord.endSec;
    const nextFirstWordStart = !isLast
      ? (words[filledSpans[i + 1]!.firstWordIdx]?.startSec ?? sceneEnd)
      : sceneEnd;
    const boundaryEnd = isLast
      ? Math.max(sceneEnd, totalDurationSec)
      : Math.max(sceneEnd, nextFirstWordStart - BOUNDARY_EPSILON_SEC);
    const sceneStart = prevEnd;
    const duration = Math.max(0.01, boundaryEnd - prevEnd);

    alignedScenes.push({ ...scene, durationSec: Number(duration.toFixed(3)) });

    captionSegments.push({
      text: scene.narration,
      startSec: Number(sceneStart.toFixed(3)),
      endSec: Number(boundaryEnd.toFixed(3)),
    });
  }

  // 合計が totalDurationSec と一致するように最後の scene を微調整
  // (durationSec と captionSegments[last].endSec を同時に動かして整合を保つ)
  const totalAligned = alignedScenes.reduce((s, sc) => s + sc.durationSec, 0);
  const diff = totalDurationSec - totalAligned;
  if (Math.abs(diff) > 0.01 && alignedScenes.length > 0) {
    const lastIdx = alignedScenes.length - 1;
    const last = alignedScenes[lastIdx]!;
    const adjustedDuration = Math.max(0.01, last.durationSec + diff);
    alignedScenes[lastIdx] = {
      ...last,
      durationSec: Number(adjustedDuration.toFixed(3)),
    };
    const lastCaption = captionSegments[lastIdx]!;
    captionSegments[lastIdx] = {
      ...lastCaption,
      endSec: Number((lastCaption.startSec + adjustedDuration).toFixed(3)),
    };
  }

  return {
    scenes: alignedScenes,
    captionSegments,
    fallbackUsed: matchCount < scenes.length,
  };
}

// =========== internal ===========

interface CharStream {
  charStream: string;
  charWordIndex: number[]; // charStream[i] がどの word に属するか
}

function buildCharStream(words: CaptionWord[]): CharStream {
  let charStream = "";
  const charWordIndex: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const normalized = normalize(words[i]!.text);
    for (const ch of normalized) {
      charStream += ch;
      charWordIndex.push(i);
    }
  }
  return { charStream, charWordIndex };
}

/**
 * 半角化・括弧/引用符/句読点/空白を剥がし、Whisper と Gemini の表記揺れを吸収する。
 * カタカナ/ひらがな/漢字/数字のみにする。
 */
export function normalize(s: string): string {
  const nfkc = s.normalize("NFKC");
  let out = "";
  for (const ch of nfkc) {
    const code = ch.codePointAt(0)!;
    // ASCII 英数
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      out += ch;
      continue;
    }
    // ひらがな・カタカナ・漢字・長音符のみ残す
    const isHiragana = code >= 0x3040 && code <= 0x309f;
    const isKatakana = code >= 0x30a0 && code <= 0x30ff;
    const isCJK = code >= 0x4e00 && code <= 0x9fff;
    const isCJKExt = code >= 0x3400 && code <= 0x4dbf;
    if (isHiragana || isKatakana || isCJK || isCJKExt) {
      out += ch;
      continue;
    }
    // それ以外（句読点・引用符・空白・記号）は削除
  }
  return out;
}

/**
 * charStream[streamPos:] から scene を消費し、対応 word index の span を返す。
 *
 * 全マッチャ (exact / anchor / LCS) は同じ bounded window 内で動作する。
 * window 幅 = max(WINDOW_MIN_CHARS, ceil(sceneLen × WINDOW_SCENE_MULTIPLIER + WINDOW_EXTRA_PAD))
 * これにより後続 scene の文字領域まで誤って食い込むのを防ぐ。
 *
 * 戦略:
 *   1. exact substring match (window 内)
 *   2. anchor fuzzy: 先頭3文字 / 末尾3文字の両方が window 内にある区間を採用
 *   3. LCS fallback: scene と window の LCS を DP で計算し、
 *      信頼度(lcsLen/sceneLen)と span 幅の両方が閾値を満たす場合のみ採用
 *   4. いずれも満たさない場合は null を返し、fillMissingSpans に補間を委ねる
 */
function consumeScene(
  charStream: string,
  charWordIndex: number[],
  streamPos: number,
  normalizedScene: string,
): { firstWordIdx: number; lastWordIdx: number } | null {
  const remaining = charStream.length - streamPos;
  if (remaining <= 0) return null;

  const windowLen = Math.min(
    remaining,
    Math.max(
      WINDOW_MIN_CHARS,
      Math.ceil(normalizedScene.length * WINDOW_SCENE_MULTIPLIER + WINDOW_EXTRA_PAD),
    ),
  );
  const searchRegion = charStream.slice(streamPos, streamPos + windowLen);

  // 1. exact substring match
  const exactIdx = searchRegion.indexOf(normalizedScene);
  if (exactIdx !== -1) {
    const absStart = streamPos + exactIdx;
    const absEnd = absStart + normalizedScene.length - 1;
    return {
      firstWordIdx: charWordIndex[absStart]!,
      lastWordIdx: charWordIndex[absEnd]!,
    };
  }

  // 2. anchor fuzzy: 先頭3文字と末尾3文字が共に window 内に検出できる区間を span とする
  const headKey = normalizedScene.slice(0, Math.min(3, normalizedScene.length));
  const tailKey = normalizedScene.slice(-Math.min(3, normalizedScene.length));
  const headIdx = searchRegion.indexOf(headKey);
  const tailIdx = searchRegion.lastIndexOf(tailKey);
  if (headIdx !== -1 && tailIdx !== -1 && tailIdx + tailKey.length > headIdx) {
    const absStart = streamPos + headIdx;
    const absEnd = streamPos + tailIdx + tailKey.length - 1;
    return {
      firstWordIdx: charWordIndex[absStart]!,
      lastWordIdx: charWordIndex[absEnd]!,
    };
  }

  // 3. LCS fallback (順序保持)。信頼度ゲートを通らないなら null。
  const lcs = computeLcsSpan(normalizedScene, searchRegion);
  if (lcs === null) return null;
  const confidenceRatio = lcs.lcsLen / normalizedScene.length;
  const spanLen = lcs.lastJ - lcs.firstJ + 1;
  const maxSpanLen = normalizedScene.length * LCS_SPAN_EXPANSION + LCS_SPAN_EXTRA;
  if (confidenceRatio < LCS_CONFIDENCE_THRESHOLD || spanLen > maxSpanLen) {
    return null;
  }
  const absStart = streamPos + lcs.firstJ;
  const absEnd = streamPos + lcs.lastJ;
  return {
    firstWordIdx: charWordIndex[absStart]!,
    lastWordIdx: charWordIndex[absEnd]!,
  };
}

/**
 * 2 文字列の Longest Common Subsequence を DP で計算し、
 * t 側での最初/最後の一致位置と LCS 長を返す。
 * 疎な一致 (LCS 長が短い / span が広すぎる) の判定は呼び出し側で行う。
 */
export function computeLcsSpan(
  s: string,
  t: string,
): { firstJ: number; lastJ: number; lcsLen: number } | null {
  const m = s.length;
  const n = t.length;
  if (m === 0 || n === 0) return null;

  // dp[i][j] = LCS length of s[:i], t[:j]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    const si = s[i - 1]!;
    const row = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= n; j++) {
      if (si === t[j - 1]) {
        row[j] = prev[j - 1]! + 1;
      } else {
        const a = prev[j]!;
        const b = row[j - 1]!;
        row[j] = a >= b ? a : b;
      }
    }
  }
  const lcsLen = dp[m]![n]!;
  if (lcsLen === 0) return null;

  // traceback で t 側の match 位置を回収（逆順に得られるので first/last を追跡）
  let i = m;
  let j = n;
  let firstJ = -1;
  let lastJ = -1;
  while (i > 0 && j > 0) {
    if (s[i - 1] === t[j - 1]) {
      const jIdx = j - 1;
      if (lastJ === -1) lastJ = jIdx;
      firstJ = jIdx;
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }
  return { firstJ, lastJ, lcsLen };
}

function charPosAfter(
  span: { firstWordIdx: number; lastWordIdx: number },
  charWordIndex: number[],
): number {
  // lastWordIdx に属する最後の char の位置 + 1
  for (let i = charWordIndex.length - 1; i >= 0; i--) {
    if (charWordIndex[i] === span.lastWordIdx) return i + 1;
  }
  return 0;
}

function fillMissingSpans(
  spans: ({ firstWordIdx: number; lastWordIdx: number } | null)[],
  totalWords: number,
): { firstWordIdx: number; lastWordIdx: number }[] {
  const result: { firstWordIdx: number; lastWordIdx: number }[] = new Array(spans.length);
  // 既知の span をそのまま置く
  for (let i = 0; i < spans.length; i++) {
    if (spans[i]) result[i] = spans[i]!;
  }
  // 前方から欠損を埋める
  for (let i = 0; i < spans.length; i++) {
    if (result[i]) continue;
    // 前後の最近接 span を探す
    let prevEnd = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (result[j]) {
        prevEnd = result[j]!.lastWordIdx;
        break;
      }
    }
    let nextStart = totalWords;
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[j]) {
        nextStart = spans[j]!.firstWordIdx;
        break;
      }
    }
    const firstWordIdx = Math.min(totalWords - 1, Math.max(0, prevEnd + 1));
    const lastWordIdx = Math.max(firstWordIdx, Math.min(totalWords - 1, nextStart - 1));
    result[i] = { firstWordIdx, lastWordIdx };
  }
  return result;
}

function fallbackLinear(scenes: Scene[], totalDurationSec: number): AlignmentResult {
  const currentTotal = scenes.reduce((s, sc) => s + sc.durationSec, 0) || 1;
  const factor = totalDurationSec / currentTotal;
  const alignedScenes = scenes.map((sc) => ({
    ...sc,
    durationSec: Number((sc.durationSec * factor).toFixed(3)),
  }));
  let cursor = 0;
  const captionSegments: CaptionSegment[] = alignedScenes.map((sc) => {
    const seg = {
      text: sc.narration,
      startSec: Number(cursor.toFixed(3)),
      endSec: Number((cursor + sc.durationSec).toFixed(3)),
    };
    cursor += sc.durationSec;
    return seg;
  });
  return { scenes: alignedScenes, captionSegments, fallbackUsed: true };
}
