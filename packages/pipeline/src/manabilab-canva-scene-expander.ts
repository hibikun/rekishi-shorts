import type {
  CanvaSceneSource,
  ManabilabCanvaScene,
  ManabilabCanvaScript,
} from "@rekishi/shared";

const MAX_CAPTION_CHARS = 18;
const MIN_CHUNK_CHARS = 4;

function shortCaption(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  const m = trimmed.match(/^[^。、！？!?\n]{1,18}/);
  if (m && m[0].trim().length > 0) return m[0].trim();
  return trimmed.slice(0, MAX_CAPTION_CHARS);
}

/**
 * 句読点（。、！？!?）でテキストを分割する。
 * - 句読点は前 chunk の末尾に残す
 * - minChars 未満の chunk は隣接 chunk と結合（先頭・末尾・中間いずれも次へ繰り上げ）
 */
export function splitByPunctuation(
  text: string,
  minChars = MIN_CHUNK_CHARS,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 1. 句読点でチャンク化
  const chunks: string[] = [];
  let buf = "";
  for (const ch of trimmed) {
    buf += ch;
    if (/[。、！？!?]/.test(ch)) {
      const piece = buf.trim();
      if (piece) chunks.push(piece);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail) chunks.push(tail);

  if (chunks.length <= 1) return chunks;

  // 2. 短すぎる chunk をマージする
  //    短い chunk は「次の chunk に連結」を基本とし、最後尾だけは前に連結する
  const merged: string[] = [];
  let pending = "";
  for (const c of chunks) {
    const combined = pending + c;
    pending = "";
    if (combined.length < minChars) {
      pending = combined;
      continue;
    }
    merged.push(combined);
  }
  if (pending) {
    if (merged.length === 0) merged.push(pending);
    else merged[merged.length - 1] += pending;
  }
  return merged;
}

interface SegmentInput {
  source: CanvaSceneSource;
  text: string;
  /** 最初の chunk に当てる初期 caption */
  leadCaption: string;
}

function buildScenesFromSegment(
  seg: SegmentInput,
  startIndex: number,
): { scenes: ManabilabCanvaScene[]; nextIndex: number } {
  const chunks = splitByPunctuation(seg.text);
  if (chunks.length === 0) {
    return { scenes: [], nextIndex: startIndex };
  }
  const scenes: ManabilabCanvaScene[] = chunks.map((chunk, i) => ({
    index: startIndex + i,
    source: seg.source,
    narration: chunk,
    caption: i === 0 ? seg.leadCaption : shortCaption(chunk, chunk),
    imagePromptJa: "",
    imagePromptEn: "",
    imageCandidates: [],
    seedancePromptJa: "",
    seedancePromptEn: "",
  }));
  return { scenes, nextIndex: startIndex + scenes.length };
}

/**
 * 台本を句読点ベースでシーン展開する。
 *
 * 1 セグメント（hook / statement / cta / punchline）の本文を「。、！？」ごとに
 * 切り、各 chunk を 1 シーンとして起こす。これにより 1 セグメントが
 * 複数シーンに展開される（例：hook が「？」「。」「。」で 3 分割）。
 *
 * imagePromptJa はユーザーが直接「どんなポーズか」を入力するフィールドとして
 * 空文字で初期化する。空のままでも画像生成 API は caption / narration から
 * 自動でポーズを推測するので、入力は任意。
 */
export function expandScriptToScenes(
  script: ManabilabCanvaScript,
): ManabilabCanvaScene[] {
  const segments: SegmentInput[] = [
    {
      source: { kind: "hook" },
      text: script.hook,
      leadCaption: shortCaption(script.hook, script.title.bottom),
    },
    ...script.statements.map<SegmentInput>((s, i) => ({
      source: { kind: "statement", statementIndex: i },
      text: `${s.claim} ${s.backupLogic}`.trim(),
      leadCaption: s.label.trim() || shortCaption(s.claim, `セグメント ${i + 1}`),
    })),
    {
      source: { kind: "cta" },
      text: script.cta,
      leadCaption: shortCaption(script.cta, "やってみよう"),
    },
    {
      source: { kind: "punchline" },
      text: script.punchline,
      leadCaption: shortCaption(script.punchline, script.punchline),
    },
  ];

  const out: ManabilabCanvaScene[] = [];
  let idx = 1;
  for (const seg of segments) {
    const { scenes, nextIndex } = buildScenesFromSegment(seg, idx);
    out.push(...scenes);
    idx = nextIndex;
  }
  return out;
}
