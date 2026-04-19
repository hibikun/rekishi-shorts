import { ScriptSchema, type Script } from "@rekishi/shared";

/**
 * Script を人間が編集しやすい Markdown にシリアライズする。
 *
 * 編集可能セクション: narration / keyTerms / readings / mnemonic
 * メタセクション: topic / hook / body / closing / estimatedDurationSec（参考表示のみ）
 *
 * 「参考表示」の値は build 時に再取り込みされるが、元の値から変化していても
 * そのまま採用する（narration を改変した場合の hook/body/closing 不整合は許容する。
 * 動画生成で実際に使われるのは narration と keyTerms と readings と mnemonic のみ）。
 */
export function scriptToDraftMd(script: Script): string {
  const lines: string[] = [];
  lines.push(`# ${script.topic.title}`);
  lines.push("");
  lines.push("> このファイルを編集してから `pnpm build <jobId>` を実行してください。");
  lines.push("> 編集OKなセクション: **narration / keyTerms / readings / mnemonic**");
  lines.push("> 編集しても無視されるセクション: topic / hook / body / closing / estimatedDurationSec");
  lines.push("");

  lines.push("## narration");
  lines.push(script.narration);
  lines.push("");

  lines.push("## keyTerms");
  for (const term of script.keyTerms) lines.push(`- ${term}`);
  if (script.keyTerms.length === 0) lines.push("<!-- 用語を追加してください -->");
  lines.push("");

  lines.push("## readings");
  lines.push("<!-- 難読語の読み仮名。TTS の誤読防止用（字幕には反映されない）。書式: 漢字: ひらがな -->");
  const readingEntries = Object.entries(script.readings ?? {});
  for (const [k, v] of readingEntries) lines.push(`- ${k}: ${v}`);
  if (readingEntries.length === 0) lines.push("<!-- 例: 阿部正弘: あべまさひろ -->");
  lines.push("");

  lines.push("## mnemonic");
  lines.push(script.mnemonic ?? "");
  lines.push("");

  if (script.items && script.items.length > 0) {
    lines.push("## items");
    lines.push("<!-- three-pick 用の内容確認表示。編集しても build では使用されない（narration が正） -->");
    const sorted = [...script.items].sort((a, b) => b.rank - a.rank);
    for (const it of sorted) {
      lines.push(`- 第${it.rank}位 ${it.name}: ${it.summary}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("<!-- 以下はメタ情報（編集しても無視されます） -->");
  lines.push("");
  lines.push("## meta");
  lines.push(`- topic.title: ${script.topic.title}`);
  lines.push(`- topic.era: ${script.topic.era ?? ""}`);
  lines.push(`- topic.subject: ${script.topic.subject}`);
  lines.push(`- topic.target: ${script.topic.target}`);
  lines.push(`- topic.format: ${script.topic.format}`);
  lines.push(`- estimatedDurationSec: ${script.estimatedDurationSec}`);
  lines.push(`- hook: ${script.hook}`);
  lines.push(`- body: ${script.body}`);
  lines.push(`- closing: ${script.closing}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * 編集された Markdown と、元の script.json (hook/body/closing 等を保持するため) から
 * Script を再構築する。editable セクション (narration/keyTerms/readings/mnemonic) のみ
 * 差分を適用する。
 */
export function draftMdToScript(md: string, original: Script): Script {
  const sections = parseSections(md);

  const narration = sections.get("narration")?.trim() ?? original.narration;

  const keyTermsRaw = sections.get("keyTerms") ?? "";
  const keyTerms = parseBulletList(keyTermsRaw);

  const readingsRaw = sections.get("readings") ?? "";
  const readings = parseReadingsMap(readingsRaw);

  const mnemonicRaw = sections.get("mnemonic")?.trim() ?? "";
  const mnemonic = mnemonicRaw.length > 0 ? mnemonicRaw : undefined;

  return ScriptSchema.parse({
    ...original,
    narration,
    keyTerms: keyTerms.length > 0 ? keyTerms : original.keyTerms,
    readings,
    mnemonic,
  });
}

/**
 * "## name" 単位で本文を分割し、{ section name -> 中身文字列 } の Map を返す。
 * 本文からは先頭コメント (<!-- ... -->) と空行を除去する。
 */
function parseSections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = md.split(/\r?\n/);
  let currentName: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentName !== null) {
      out.set(currentName, buffer.join("\n"));
    }
    buffer = [];
  };

  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      currentName = m[1]!.trim();
      continue;
    }
    // horizontal rule (---) はメタ境界。収集中のセクションを閉じる
    if (/^---\s*$/.test(line)) {
      flush();
      currentName = null;
      continue;
    }
    if (currentName !== null) buffer.push(line);
  }
  flush();
  return out;
}

function parseBulletList(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--") || trimmed.length === 0) continue;
    const m = /^[-*]\s+(.+?)\s*$/.exec(trimmed);
    if (m) out.push(m[1]!);
  }
  return out;
}

function parseReadingsMap(body: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--") || trimmed.length === 0) continue;
    // 形式: - 漢字: ひらがな （コロンは全角でも半角でも許容）
    const m = /^[-*]\s+(.+?)[：:]\s*(.+?)\s*$/.exec(trimmed);
    if (m) {
      const key = m[1]!.trim();
      const value = m[2]!.trim();
      if (key.length > 0 && value.length > 0) map[key] = value;
    }
  }
  return map;
}

/**
 * keyTerms のうち narration に含まれないものを抽出する（警告表示用）。
 */
export function findOrphanKeyTerms(script: Script): string[] {
  return script.keyTerms.filter((t) => !script.narration.includes(t));
}
