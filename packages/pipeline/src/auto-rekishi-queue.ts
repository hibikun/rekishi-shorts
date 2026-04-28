import fs from "node:fs/promises";
import path from "node:path";
import { channelPackageDir } from "@rekishi/shared/channel";

/**
 * 台本キューの状態。
 *   - review-needed: auto-draft が出力直後。人間がレビューする
 *   - ready:         レビュー完了、auto-publish の対象
 *   - in-progress:   auto-publish が掴んでいる最中
 *   - done:          公開済み
 *   - skipped:       人間が見送ると決めたもの（手動で書き換え）
 */
export type QueueStatus =
  | "review-needed"
  | "ready"
  | "in-progress"
  | "done"
  | "skipped";

/** queue ファイル frontmatter のスキーマ（フラット文字列のみ） */
export interface QueueFrontmatter {
  status: QueueStatus;
  slug: string;
  jobId?: string;
  poolTitle?: string;
  poolLineNumber?: number;
  era?: string;
  pattern?: string;
  videoTitleTop?: string;
  videoTitleBottom: string;
  mnemonic?: string;
  estimatedDurationSec?: number;
  publishedUrl?: string;
  publishedAt?: string;
  privacy?: string;
}

/** queue ファイル全体（frontmatter + 本文セクション） */
export interface QueueFile {
  /** ファイルパス（ディレクトリ + slug.md） */
  filePath: string;
  /** YAML frontmatter 部分 */
  meta: QueueFrontmatter;
  /** ## narration セクション本文 */
  narration: string;
  /** ## hook 本文 */
  hook: string;
  /** ## body 本文 */
  body: string;
  /** ## closing 本文 */
  closing: string;
  /** ## keyTerms 箇条書きを配列化 */
  keyTerms: string[];
  /** ## readings の `- 漢字: ひらがな` を Map に */
  readings: Record<string, string>;
  /** ## research セクション（research.md 全文の埋め込み） */
  research: string;
}

export function queueDir(): string {
  return path.join(channelPackageDir("rekishi"), "queue");
}

export function queueFilePath(slug: string): string {
  return path.join(queueDir(), `${slug}.md`);
}

/* ============================================================
 * 読み込み
 * ============================================================ */

export async function readQueueFile(filePath: string): Promise<QueueFile> {
  const raw = await fs.readFile(filePath, "utf-8");
  return parseQueueFile(filePath, raw);
}

export async function listQueueFiles(): Promise<QueueFile[]> {
  const dir = queueDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: QueueFile[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const filePath = path.join(dir, name);
    try {
      out.push(await readQueueFile(filePath));
    } catch {
      // 壊れたファイルはスキップ
    }
  }
  // status: ready を上に、それ以外は名前順
  out.sort((a, b) => {
    const aReady = a.meta.status === "ready" ? 0 : 1;
    const bReady = b.meta.status === "ready" ? 0 : 1;
    if (aReady !== bReady) return aReady - bReady;
    return a.filePath.localeCompare(b.filePath);
  });
  return out;
}

/** publish が次に処理する 1 件を返す（status === "ready" の最初） */
export async function pickNextReady(): Promise<QueueFile | null> {
  const files = await listQueueFiles();
  return files.find((f) => f.meta.status === "ready") ?? null;
}

/* ============================================================
 * 書き込み（status 遷移）
 * ============================================================ */

export async function writeQueueFile(file: QueueFile): Promise<void> {
  const text = serializeQueueFile(file);
  await fs.mkdir(path.dirname(file.filePath), { recursive: true });
  const tmp = `${file.filePath}.tmp`;
  await fs.writeFile(tmp, text, "utf-8");
  await fs.rename(tmp, file.filePath);
}

export async function markQueueInProgress(slug: string, jobId: string): Promise<QueueFile> {
  return await withQueueLock(slug, async () => {
    const file = await readQueueFile(queueFilePath(slug));
    file.meta.status = "in-progress";
    file.meta.jobId = jobId;
    await writeQueueFile(file);
    return file;
  });
}

export async function markQueueDone(
  slug: string,
  opts: { jobId: string; url: string; privacy?: string },
): Promise<QueueFile> {
  return await withQueueLock(slug, async () => {
    const file = await readQueueFile(queueFilePath(slug));
    file.meta.status = "done";
    file.meta.jobId = opts.jobId;
    file.meta.publishedUrl = opts.url;
    file.meta.publishedAt = new Date().toISOString();
    file.meta.privacy = opts.privacy ?? "public";
    await writeQueueFile(file);
    return file;
  });
}

/** in-progress を ready に戻す（失敗時の救済） */
export async function unlockQueue(slug: string): Promise<QueueFile> {
  return await withQueueLock(slug, async () => {
    const file = await readQueueFile(queueFilePath(slug));
    if (file.meta.status === "in-progress") {
      file.meta.status = "ready";
      await writeQueueFile(file);
    }
    return file;
  });
}

/* ============================================================
 * 簡易ロック（ファイル単位）
 * ============================================================ */

const LOCK_RETRY_INTERVAL_MS = 5_000;
const LOCK_RETRY_COUNT = 6;

async function withQueueLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = queueFilePath(slug) + ".lock";
  for (let i = 0; i < LOCK_RETRY_COUNT; i++) {
    try {
      const handle = await fs.open(lockFile, "wx");
      await handle.close();
      try {
        return await fn();
      } finally {
        await fs.unlink(lockFile).catch(() => undefined);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (i === LOCK_RETRY_COUNT - 1) {
        throw new Error(
          `${path.basename(lockFile)} を ${LOCK_RETRY_COUNT} 回リトライしても取得できませんでした`,
        );
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_INTERVAL_MS));
    }
  }
  throw new Error("unreachable");
}

/* ============================================================
 * frontmatter + section パーサ
 * ============================================================ */

const FRONTMATTER_DELIM = /^---\s*$/;

function parseQueueFile(filePath: string, raw: string): QueueFile {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || !FRONTMATTER_DELIM.test(lines[0] ?? "")) {
    throw new Error(`queue ファイル先頭に '---' frontmatter がありません: ${filePath}`);
  }

  let i = 1;
  const fmLines: string[] = [];
  while (i < lines.length && !FRONTMATTER_DELIM.test(lines[i] ?? "")) {
    fmLines.push(lines[i] ?? "");
    i++;
  }
  if (i >= lines.length) {
    throw new Error(`queue ファイル frontmatter の終端 '---' がありません: ${filePath}`);
  }
  i++; // skip closing '---'

  const meta = parseFrontmatter(fmLines, filePath);
  const sections = parseSections(lines.slice(i));

  return {
    filePath,
    meta,
    narration: (sections.get("narration") ?? "").trim(),
    hook: (sections.get("hook") ?? "").trim(),
    body: (sections.get("body") ?? "").trim(),
    closing: (sections.get("closing") ?? "").trim(),
    keyTerms: parseBulletList(sections.get("keyTerms") ?? ""),
    readings: parseReadingsMap(sections.get("readings") ?? ""),
    research: (sections.get("research") ?? "").trim(),
  };
}

function parseFrontmatter(fmLines: string[], filePath: string): QueueFrontmatter {
  const map = new Map<string, string>();
  for (const line of fmLines) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    map.set(m[1]!, m[2] ?? "");
  }

  const status = map.get("status") ?? "review-needed";
  if (!isQueueStatus(status)) {
    throw new Error(`queue ファイル ${filePath} の status が不正: ${status}`);
  }
  const slug = map.get("slug") ?? "";
  if (!slug) {
    throw new Error(`queue ファイル ${filePath} に slug が必要です`);
  }
  const videoTitleBottom = map.get("videoTitleBottom") ?? "";
  if (!videoTitleBottom) {
    throw new Error(`queue ファイル ${filePath} に videoTitleBottom が必要です`);
  }

  const meta: QueueFrontmatter = {
    status,
    slug,
    videoTitleBottom,
  };
  const optStr = (k: string): string | undefined => {
    const v = map.get(k);
    return v && v.length > 0 ? v : undefined;
  };
  const optNum = (k: string): number | undefined => {
    const v = map.get(k);
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  meta.jobId = optStr("jobId");
  meta.poolTitle = optStr("poolTitle");
  meta.poolLineNumber = optNum("poolLineNumber");
  meta.era = optStr("era");
  meta.pattern = optStr("pattern");
  meta.videoTitleTop = optStr("videoTitleTop");
  meta.mnemonic = optStr("mnemonic");
  meta.estimatedDurationSec = optNum("estimatedDurationSec");
  meta.publishedUrl = optStr("publishedUrl");
  meta.publishedAt = optStr("publishedAt");
  meta.privacy = optStr("privacy");
  return meta;
}

function isQueueStatus(s: string): s is QueueStatus {
  return ["review-needed", "ready", "in-progress", "done", "skipped"].includes(s);
}

function parseSections(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let currentName: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentName !== null) out.set(currentName, buffer.join("\n"));
    buffer = [];
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      currentName = m[1]!.trim();
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
    if (!trimmed || trimmed.startsWith("<!--") || trimmed.startsWith("#")) continue;
    const m = /^[-*]\s+(.+?)\s*$/.exec(trimmed);
    if (m) out.push(m[1]!);
  }
  return out;
}

function parseReadingsMap(body: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("<!--") || trimmed.startsWith("#")) continue;
    const m = /^[-*]\s+(.+?)[：:]\s*(.+?)\s*$/.exec(trimmed);
    if (m) {
      const key = m[1]!.trim();
      const value = m[2]!.trim();
      if (key && value) map[key] = value;
    }
  }
  return map;
}

/* ============================================================
 * シリアライザ
 * ============================================================ */

export function serializeQueueFile(file: QueueFile): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`status: ${file.meta.status}`);
  lines.push(`slug: ${file.meta.slug}`);
  lines.push(`jobId: ${file.meta.jobId ?? ""}`);
  lines.push(`poolTitle: ${file.meta.poolTitle ?? ""}`);
  lines.push(`poolLineNumber: ${file.meta.poolLineNumber ?? ""}`);
  lines.push(`era: ${file.meta.era ?? ""}`);
  lines.push(`pattern: ${file.meta.pattern ?? ""}`);
  lines.push(`videoTitleTop: ${file.meta.videoTitleTop ?? ""}`);
  lines.push(`videoTitleBottom: ${file.meta.videoTitleBottom}`);
  lines.push(`mnemonic: ${file.meta.mnemonic ?? ""}`);
  lines.push(
    `estimatedDurationSec: ${file.meta.estimatedDurationSec ?? ""}`,
  );
  lines.push(`publishedUrl: ${file.meta.publishedUrl ?? ""}`);
  lines.push(`publishedAt: ${file.meta.publishedAt ?? ""}`);
  lines.push(`privacy: ${file.meta.privacy ?? ""}`);
  lines.push("---");
  lines.push("");

  lines.push("## narration");
  lines.push(file.narration);
  lines.push("");

  lines.push("## hook");
  lines.push(file.hook);
  lines.push("");

  lines.push("## body");
  lines.push(file.body);
  lines.push("");

  lines.push("## closing");
  lines.push(file.closing);
  lines.push("");

  lines.push("## keyTerms");
  for (const t of file.keyTerms) lines.push(`- ${t}`);
  if (file.keyTerms.length === 0) lines.push("<!-- 用語を追加してください -->");
  lines.push("");

  lines.push("## readings");
  lines.push("<!-- 難読語の読み仮名。TTS の誤読防止用（字幕には反映されない）。書式: 漢字: ひらがな -->");
  const readingEntries = Object.entries(file.readings ?? {});
  for (const [k, v] of readingEntries) lines.push(`- ${k}: ${v}`);
  if (readingEntries.length === 0) lines.push("<!-- 例: 阿部正弘: あべまさひろ -->");
  lines.push("");

  lines.push("## research");
  lines.push("<!-- auto-draft が research.md 全文を埋め込み。レビュー後に台本を編集する判断材料 -->");
  lines.push(file.research);
  lines.push("");

  return lines.join("\n");
}
