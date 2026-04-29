import type {
  ManabilabCanvaScene,
  ManabilabCanvaScript,
} from "@rekishi/shared";

const MAX_CAPTION_CHARS = 18;

function shortCaption(text: string, fallback: string): string {
  // 句読点で区切って先頭を取り、なければ字数で切る
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  const m = trimmed.match(/^[^。、！？!?\n]{1,18}/);
  if (m && m[0].trim().length > 0) return m[0].trim();
  return trimmed.slice(0, MAX_CAPTION_CHARS);
}

/**
 * 台本を 1 セグメント = 1 シーンに展開する。
 *
 * imagePromptJa はユーザーが直接「どんなポーズか」を入力するフィールドとして
 * 空文字で初期化する。空のままでも画像生成 API は caption / narration から
 * 自動でポーズを推測するので、入力は任意。
 */
export function expandScriptToScenes(
  script: ManabilabCanvaScript,
): ManabilabCanvaScene[] {
  const out: ManabilabCanvaScene[] = [];
  let idx = 1;

  // 1. hook
  out.push({
    index: idx++,
    source: { kind: "hook" },
    narration: script.hook,
    caption: shortCaption(script.hook, script.title.bottom),
    imagePromptJa: "",
    imagePromptEn: "",
  });

  // 2. statements
  script.statements.forEach((s, i) => {
    const body = `${s.claim} ${s.backupLogic}`.trim();
    out.push({
      index: idx++,
      source: { kind: "statement", statementIndex: i },
      narration: body,
      caption: s.label.trim() || shortCaption(s.claim, `セグメント ${i + 1}`),
      imagePromptJa: "",
      imagePromptEn: "",
    });
  });

  // 3. cta
  out.push({
    index: idx++,
    source: { kind: "cta" },
    narration: script.cta,
    caption: shortCaption(script.cta, "やってみよう"),
    imagePromptJa: "",
    imagePromptEn: "",
  });

  // 4. punchline
  out.push({
    index: idx++,
    source: { kind: "punchline" },
    narration: script.punchline,
    caption: shortCaption(script.punchline, script.punchline),
    imagePromptJa: "",
    imagePromptEn: "",
  });

  return out;
}
