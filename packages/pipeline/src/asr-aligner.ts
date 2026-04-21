import fs from "node:fs";
import { File } from "node:buffer";
import OpenAI from "openai";
import { CaptionWordSchema, type CaptionWord } from "@rekishi/shared";
import { config } from "./config.js";

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface AlignCaptionsResult {
  words: CaptionWord[];
  totalDurationSec: number;
  usage: {
    whisperAudioSec: number;
    textTranscribeAudioSec: number;
  };
  /** whisper-1 の転写がガードで棄却されたか */
  brokenByGuard: boolean;
  /** ガード判定の詳細シグナル（デバッグ用） */
  qualitySignals: QualitySignals;
}

interface QualitySignals {
  zeroLengthRatio: number;
  englishTokenCount: number;
  firstWordStartSec: number;
  lastWordEndSec: number;
  coverageRatio: number;
  monotonic: boolean;
  wordCountRatio: number;
  jaccardToScript: number;
  broken: boolean;
  reasons: string[];
}

export interface AlignCaptionsOptions {
  scriptText: string;
  /** 難読語の「漢字表記: ひらがな読み」マップ。Whisper prompt に表記 bias として注入 */
  readings?: Record<string, string>;
  /** keyTerms も難読語として bias に含める */
  keyTerms?: string[];
}

/**
 * 音声ファイルから word 単位の字幕タイムスタンプを得る。
 *
 * ハイブリッド戦略:
 * 1. gpt-4o-mini-transcribe で text を取得（whisper-1 より高精度、ただし word timestamp は非対応）
 * 2. whisper-1 で word timestamps を取得（従来ロジック）
 * 3. 品質ガードで whisper-1 の出力が破綻していないか判定
 *    - 破綻していれば script.narration をソースに線形配分で words を作り直す
 *    - 破綻していなければ whisper-1 の words をそのまま使う
 *
 * 破綻の典型例: 難読固有名詞密集コンテンツで whisper-1 がハルシネーションし、
 * ゼロ長 word が大量発生、英字断片が混入、先頭 word 開始が遅延する。
 */
export async function alignCaptions(
  audioPath: string,
  opts: AlignCaptionsOptions,
): Promise<AlignCaptionsResult> {
  const whisperPrompt = buildWhisperBiasPrompt(opts);
  const [whisperResult, textResult] = await Promise.all([
    runWhisperWords(audioPath, whisperPrompt),
    runGpt4oMiniTranscribe(audioPath, opts.scriptText),
  ]);

  const totalDurationSec = whisperResult.durationSec || textResult.durationSec;
  const signals = assessWhisperQuality(
    whisperResult.words,
    opts.scriptText,
    textResult.text,
    totalDurationSec,
  );

  if (signals.broken) {
    const words = buildLinearWords(opts.scriptText, totalDurationSec);
    return {
      words,
      totalDurationSec,
      usage: {
        whisperAudioSec: whisperResult.durationSec,
        textTranscribeAudioSec: textResult.durationSec,
      },
      brokenByGuard: true,
      qualitySignals: signals,
    };
  }

  return {
    words: whisperResult.words,
    totalDurationSec,
    usage: {
      whisperAudioSec: whisperResult.durationSec,
      textTranscribeAudioSec: textResult.durationSec,
    },
    brokenByGuard: false,
    qualitySignals: signals,
  };
}

// =================== internal ===================

async function runWhisperWords(
  audioPath: string,
  prompt: string,
): Promise<{ words: CaptionWord[]; durationSec: number }> {
  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const buffer = fs.readFileSync(audioPath);
  const ext = audioPath.endsWith(".wav") ? "wav" : "mp3";
  const mime = ext === "wav" ? "audio/wav" : "audio/mpeg";
  const file = new File([buffer], `narration.${ext}`, { type: mime });

  const transcription = (await openai.audio.transcriptions.create({
    file: file as unknown as Parameters<typeof openai.audio.transcriptions.create>[0]["file"],
    model: config.openai.whisperModel,
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
    language: "ja",
    prompt,
  })) as unknown as { words?: WhisperWord[]; duration?: number };

  const rawWords = transcription.words ?? [];
  const merged = mergeDigitChunks(rawWords);
  const words: CaptionWord[] = merged.map((w) =>
    CaptionWordSchema.parse({
      text: w.word,
      startSec: w.start,
      endSec: w.end,
    }),
  );

  const durationSec = transcription.duration ?? (words.at(-1)?.endSec ?? 0);
  return { words, durationSec };
}

async function runGpt4oMiniTranscribe(
  audioPath: string,
  scriptText: string,
): Promise<{ text: string; durationSec: number }> {
  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const buffer = fs.readFileSync(audioPath);
  const ext = audioPath.endsWith(".wav") ? "wav" : "mp3";
  const mime = ext === "wav" ? "audio/wav" : "audio/mpeg";
  const file = new File([buffer], `narration.${ext}`, { type: mime });

  // gpt-4o(-mini)-transcribe は response_format=text / json のみ対応（verbose_json 非対応）
  // text だけ使うので text を要求する
  const res = (await openai.audio.transcriptions.create({
    file: file as unknown as Parameters<typeof openai.audio.transcriptions.create>[0]["file"],
    model: config.openai.textTranscribeModel,
    language: "ja",
    response_format: "text",
    prompt: scriptText.slice(0, 500),
  })) as unknown as string | { text?: string };

  const text = typeof res === "string" ? res : res.text ?? "";

  // duration が取れないので WAV ヘッダから算出
  const durationSec = inferWavDurationSec(buffer);
  return { text, durationSec };
}

/**
 * Whisper word 出力が破綻しているかを複数シグナルで判定する。
 *
 * 判定方針（Codex レビュー反映）:
 * - 強シグナル（単独で broken）: zeroLengthRatio が高い / 単調性破綻 / coverage が極端に低い
 * - 弱シグナル（複数合致で broken）: firstWordStart 遅延、英字混入、jaccard 低下、word数比ズレ
 * - jaccard は補助。日本語は漢字/かな揺れで下がりやすいため単独棄却は避ける
 */
function assessWhisperQuality(
  words: CaptionWord[],
  scriptText: string,
  referenceText: string,
  totalDurationSec: number,
): QualitySignals {
  const strongReasons: string[] = [];
  const weakReasons: string[] = [];

  const zeroLengthRatio =
    words.length === 0 ? 1 : words.filter((w) => w.endSec - w.startSec < 0.001).length / words.length;
  if (zeroLengthRatio > 0.3) strongReasons.push(`zeroLengthRatio=${(zeroLengthRatio * 100).toFixed(0)}%`);

  // 単調性: startSec が逆戻りしていないか
  let monotonic = true;
  for (let i = 1; i < words.length; i++) {
    if (words[i]!.startSec < words[i - 1]!.startSec - 0.01) {
      monotonic = false;
      break;
    }
  }
  if (!monotonic) strongReasons.push("timestamps not monotonic");

  // 終端 coverage: 最後の word が totalDuration の何%地点で終わっているか
  const lastWordEndSec = words[words.length - 1]?.endSec ?? 0;
  const coverageRatio = totalDurationSec > 0 ? lastWordEndSec / totalDurationSec : 0;
  if (totalDurationSec > 0 && coverageRatio < 0.6) {
    strongReasons.push(`coverage=${(coverageRatio * 100).toFixed(0)}%`);
  }

  const englishTokenCount = words.filter((w) => /^[A-Za-z]{2,}/.test(w.text)).length;
  if (englishTokenCount > 2) weakReasons.push(`englishTokens=${englishTokenCount}`);

  const firstWordStartSec = words[0]?.startSec ?? 0;
  if (firstWordStartSec > 2.0) weakReasons.push(`firstWordStart=${firstWordStartSec.toFixed(2)}s`);

  // word count 比率: Whisper は各モーラ/短単位で切るので日本語なら原文文字数の 0.5〜1.5 倍が目安
  const scriptCharCount = normalizeForSimilarity(scriptText).length;
  const wordCountRatio = scriptCharCount > 0 ? words.length / scriptCharCount : 1;
  if (wordCountRatio < 0.3 || wordCountRatio > 2.5) {
    weakReasons.push(`wordCountRatio=${wordCountRatio.toFixed(2)}`);
  }

  const whisperText = words.map((w) => w.text).join("");
  // reference は gpt-4o-mini の出力（正しい転写）を使う。空なら script にフォールバック
  const reference = referenceText.trim().length > 0 ? referenceText : scriptText;
  const jaccard = jaccardSimilarity(whisperText, reference);
  if (jaccard < 0.5) weakReasons.push(`jaccardToReference=${jaccard.toFixed(2)}`);

  // 判定: 強シグナル1つ or 弱シグナル2つ以上で broken
  const broken = strongReasons.length > 0 || weakReasons.length >= 2;
  const reasons = [...strongReasons, ...weakReasons];

  return {
    zeroLengthRatio,
    englishTokenCount,
    firstWordStartSec,
    lastWordEndSec,
    coverageRatio,
    monotonic,
    wordCountRatio,
    jaccardToScript: jaccard,
    broken,
    reasons,
  };
}

/**
 * Whisper の prompt は ~224 token の語彙 bias ヒント。日本語は NFC で ~1token/char なので
 * 200 chars を超えないよう、語彙辞書を優先で入れ、余った分だけ narration 先頭を足す。
 *
 * 形式（Codex 推奨）: 「用語: 三下り半（みくだりはん）、公事方御定書（くじかたおさだめがき）、…」
 * 「表記（読み）」を並べて、Whisper に「この音はこの漢字で出してほしい」を bias する。
 */
export function buildWhisperBiasPrompt(opts: AlignCaptionsOptions): string {
  const MAX_CHARS = 200;
  const entries: string[] = [];
  const seen = new Set<string>();

  if (opts.readings) {
    for (const [term, reading] of Object.entries(opts.readings)) {
      if (!term || seen.has(term)) continue;
      entries.push(`${term}（${reading}）`);
      seen.add(term);
    }
  }
  if (opts.keyTerms) {
    for (const term of opts.keyTerms) {
      if (!term || seen.has(term)) continue;
      // keyTerms は読み不明なのでそのまま足す
      entries.push(term);
      seen.add(term);
    }
  }

  const header = entries.length > 0 ? `日本史。用語: ${entries.join("、")}。` : "";
  const remaining = Math.max(0, MAX_CHARS - header.length);
  const narrationExcerpt = opts.scriptText.slice(0, remaining);
  return (header + narrationExcerpt).slice(0, MAX_CHARS);
}

/**
 * script.narration を 1 文字 = 1 word として、文字数に比例させて
 * 0..durationSec に線形配分する。空白は word として残さない。
 */
function buildLinearWords(scriptText: string, durationSec: number): CaptionWord[] {
  const chars = [...scriptText].filter((c) => !/\s/.test(c));
  const n = chars.length;
  if (n === 0 || durationSec <= 0) return [];

  const perChar = durationSec / n;
  const words: CaptionWord[] = [];
  for (let i = 0; i < n; i++) {
    const start = Number((i * perChar).toFixed(3));
    const end = Number(((i + 1) * perChar).toFixed(3));
    words.push(
      CaptionWordSchema.parse({
        text: chars[i]!,
        startSec: start,
        endSec: Math.max(end, start + 0.001),
      }),
    );
  }
  return words;
}

/**
 * 正規化した文字 2-gram の Jaccard 類似度。0..1。
 */
function jaccardSimilarity(a: string, b: string): number {
  const an = normalizeForSimilarity(a);
  const bn = normalizeForSimilarity(b);
  if (an.length === 0 || bn.length === 0) return 0;
  const ag = bigrams(an);
  const bg = bigrams(bn);
  if (ag.size === 0 || bg.size === 0) return 0;
  let intersect = 0;
  for (const g of ag) if (bg.has(g)) intersect++;
  const unionSize = ag.size + bg.size - intersect;
  return unionSize === 0 ? 0 : intersect / unionSize;
}

function normalizeForSimilarity(s: string): string {
  return s.normalize("NFKC").replace(/[\s、。，．「」『』()（）""''\-—"\[\]]/g, "");
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Whisper は「1853年」を「18」「53」「年」に分割しがち。連続する数字を再結合。 */
function mergeDigitChunks(words: WhisperWord[]): WhisperWord[] {
  if (words.length === 0) return words;
  const DIGITS = /^[0-9]+$/;
  const out: WhisperWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && DIGITS.test(prev.word) && DIGITS.test(w.word) && w.start - prev.end < 0.25) {
      prev.word = prev.word + w.word;
      prev.end = w.end;
      continue;
    }
    out.push({ ...w });
  }
  return out;
}

/** PCM WAV ヘッダ (44bytes) から duration を推定する。失敗時は 0。 */
function inferWavDurationSec(buffer: Buffer): number {
  try {
    if (buffer.length < 44 || buffer.subarray(0, 4).toString() !== "RIFF") return 0;
    const sampleRate = buffer.readUInt32LE(24);
    const byteRate = buffer.readUInt32LE(28);
    const dataSize = buffer.readUInt32LE(40);
    if (byteRate > 0) return dataSize / byteRate;
    const channels = buffer.readUInt16LE(22);
    const bitsPerSample = buffer.readUInt16LE(34);
    return dataSize / (sampleRate * channels * (bitsPerSample / 8));
  } catch {
    return 0;
  }
}
