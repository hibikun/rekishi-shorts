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

function deriveImagePromptJa(
  topicTitle: string,
  hint: string,
  body: string,
): string {
  const hintPart = hint.trim() ? `${hint.trim()} を表現する` : "";
  return `${topicTitle} の YouTube ショート動画用イラスト。${hintPart}9:16 縦構図、明るく親しみやすいフラットイラスト。テキスト要素は描かない。文脈: ${body
    .replace(/\s+/g, " ")
    .slice(0, 80)}`;
}

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
    imagePromptJa: deriveImagePromptJa(
      script.topic.title,
      "視聴者を引き止める印象的な掴み",
      script.hook,
    ),
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
      imagePromptJa: deriveImagePromptJa(script.topic.title, s.label, s.claim),
      imagePromptEn: "",
    });
  });

  // 3. cta
  out.push({
    index: idx++,
    source: { kind: "cta" },
    narration: script.cta,
    caption: shortCaption(script.cta, "やってみよう"),
    imagePromptJa: deriveImagePromptJa(
      script.topic.title,
      "視聴者の小さな行動を促すシーン",
      script.cta,
    ),
    imagePromptEn: "",
  });

  // 4. punchline
  out.push({
    index: idx++,
    source: { kind: "punchline" },
    narration: script.punchline,
    caption: shortCaption(script.punchline, script.punchline),
    imagePromptJa: deriveImagePromptJa(
      script.topic.title,
      "余韻とツッコミ余地のある締めシーン",
      script.punchline,
    ),
    imagePromptEn: "",
  });

  return out;
}
