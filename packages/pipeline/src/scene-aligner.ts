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
    const firstWord = words[span.firstWordIdx] ?? lastWordFallback;
    const lastWord = words[span.lastWordIdx] ?? lastWordFallback;

    // scene 境界: 前 scene の終端を開始とし、現 scene 末尾 word の endSec を終了とする。
    // Whisper が冒頭/末尾の短音素を取りこぼしても、字幕を連続させて無表示区間を作らない。
    const prevEnd = alignedScenes.at(-1)
      ? alignedScenes.reduce((acc, s) => acc + s.durationSec, 0)
      : 0;
    const isLast = i === scenes.length - 1;
    const sceneEnd = lastWord.endSec;
    const effectiveEnd = isLast ? Math.max(sceneEnd, totalDurationSec) : sceneEnd;
    const sceneStart = prevEnd;
    const captionEnd = isLast ? effectiveEnd : sceneEnd;
    const duration = Math.max(0.01, effectiveEnd - prevEnd);

    alignedScenes.push({ ...scene, durationSec: Number(duration.toFixed(3)) });

    captionSegments.push({
      text: scene.narration,
      startSec: Number(sceneStart.toFixed(3)),
      endSec: Number(captionEnd.toFixed(3)),
    });
  }

  // 合計が totalDurationSec と一致するように最後の scene を微調整
  const totalAligned = alignedScenes.reduce((s, sc) => s + sc.durationSec, 0);
  const diff = totalDurationSec - totalAligned;
  if (Math.abs(diff) > 0.01 && alignedScenes.length > 0) {
    const last = alignedScenes[alignedScenes.length - 1]!;
    alignedScenes[alignedScenes.length - 1] = {
      ...last,
      durationSec: Number(Math.max(0.01, last.durationSec + diff).toFixed(3)),
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
 * charStream[streamPos:] から scene を消費し、最後にマッチした word index を返す。
 * 戦略:
 *   1. normalizedScene をそのまま含むか（exact）探す。ウィンドウは streamPos から先 N 文字以内に限定
 *   2. 見つからない場合は、scene の先頭 3 文字／末尾 3 文字で anchor 位置を推定し、その範囲を span とする
 */
function consumeScene(
  charStream: string,
  charWordIndex: number[],
  streamPos: number,
  normalizedScene: string,
): { firstWordIdx: number; lastWordIdx: number } | null {
  const searchRegion = charStream.slice(streamPos);
  if (searchRegion.length === 0) return null;

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

  // 2. anchor fuzzy: 先頭3文字と末尾3文字が共に検出できる区間を span とする
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

  // 3. 最終手段: normalizedScene の半分以上の文字が含まれる最小 window を見つける
  // （小さい scene でも壊れないよう軽量 fuzzy）
  const need = Math.max(2, Math.ceil(normalizedScene.length * 0.5));
  const charSet = new Set<string>(normalizedScene);
  let bestStart = -1;
  let bestEnd = -1;
  let bestCount = 0;
  for (let i = streamPos; i < charStream.length; i++) {
    if (!charSet.has(charStream[i]!)) continue;
    let count = 0;
    const windowEnd = Math.min(charStream.length, i + normalizedScene.length + 4);
    for (let j = i; j < windowEnd; j++) {
      if (charSet.has(charStream[j]!)) count++;
    }
    if (count >= need && count > bestCount) {
      bestStart = i;
      bestEnd = windowEnd - 1;
      bestCount = count;
    }
  }
  if (bestStart !== -1) {
    return {
      firstWordIdx: charWordIndex[bestStart]!,
      lastWordIdx: charWordIndex[bestEnd]!,
    };
  }

  return null;
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
