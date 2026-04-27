import fs from "node:fs/promises";
import path from "node:path";
import { channelPackageDir } from "@rekishi/shared/channel";

export type PoolStatus = "available" | "in-progress" | "done" | "skip";
export type PoolRegion = "japan" | "world";

export interface PoolEntry {
  /** 元の行（lineNumber 起点で書き戻すのでそのまま保持） */
  rawLine: string;
  status: PoolStatus;
  region: PoolRegion | null;
  era: string;
  title: string;
  pattern?: string;
  description: string;
  needsFactCheck: boolean;
  jobId?: string;
  publishedUrl?: string;
  /** ファイル先頭から数えた 0-indexed 行番号 */
  lineNumber: number;
}

export function poolPath(): string {
  // packages/channels/topic-ideas-pool.md（横断ストック）
  return path.resolve(channelPackageDir("rekishi"), "..", "topic-ideas-pool.md");
}

const ENTRY_PATTERN =
  /^- \[(?<status>[ ~✅])\] \*\*(?<title>[^*]+)\*\*(?:\s+\[(?<pattern>[A-Z])\])?\s*(?:—|―)\s*(?<rest>.+)$/;

const REGION_JP = /^##\s+🇯🇵\s+日本史/;
const REGION_WORLD = /^##\s+🌍\s+世界史/;
const REGION_OTHER = /^##\s+/;
const ERA_PATTERN = /^###\s+(.+?)(?:\s*\(\d+\))?\s*$/;

const JOB_ID_IN_REST = /jobId\s*`([0-9a-f]{8})`/;
const URL_IN_REST = /(https?:\/\/\S+)/;

function parseStatus(marker: string): PoolStatus {
  if (marker === "✅") return "done";
  if (marker === "~") return "in-progress";
  if (marker === " ") return "available";
  return "skip";
}

export async function readPool(): Promise<PoolEntry[]> {
  const raw = await fs.readFile(poolPath(), "utf-8");
  const lines = raw.split("\n");
  const entries: PoolEntry[] = [];
  let region: PoolRegion | null = null;
  let era = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (REGION_JP.test(line)) {
      region = "japan";
      era = "";
      continue;
    }
    if (REGION_WORLD.test(line)) {
      region = "world";
      era = "";
      continue;
    }
    if (REGION_OTHER.test(line)) {
      // 🎯 系のセクションなど（対象外）
      region = null;
      era = "";
      continue;
    }

    const eraMatch = ERA_PATTERN.exec(line);
    if (eraMatch && eraMatch[1]) {
      era = eraMatch[1].trim();
      continue;
    }

    const m = ENTRY_PATTERN.exec(line);
    if (!m || !m.groups) continue;

    const status = parseStatus(m.groups.status ?? " ");
    const title = (m.groups.title ?? "").trim();
    const pattern = m.groups.pattern || undefined;
    const rest = m.groups.rest ?? "";
    const needsFactCheck = rest.includes("⚠裏取り要");
    const jobIdMatch = JOB_ID_IN_REST.exec(rest);
    const urlMatch = URL_IN_REST.exec(rest);

    entries.push({
      rawLine: line,
      status,
      region,
      era,
      title,
      pattern,
      description: rest,
      needsFactCheck,
      jobId: jobIdMatch ? jobIdMatch[1] : undefined,
      publishedUrl: urlMatch ? urlMatch[1] : undefined,
      lineNumber: i,
    });
  }
  return entries;
}

export async function pickNextAvailable(): Promise<PoolEntry | null> {
  const entries = await readPool();
  for (const e of entries) {
    if (e.region !== "japan") continue;
    if (e.status !== "available") continue;
    if (e.needsFactCheck) continue;
    if (!e.title) continue;
    return e;
  }
  return null;
}

export async function listAvailable(limit = 10): Promise<PoolEntry[]> {
  const entries = await readPool();
  return entries
    .filter((e) => e.region === "japan" && e.status === "available" && !e.needsFactCheck)
    .slice(0, limit);
}

interface MarkOptions {
  jobId: string;
  startedAt?: Date;
}

/**
 * 該当行を `[~]` に置換し、行末に jobId / startedAt を append する。
 *   旧: `- [ ] **タイトル** [B] — 説明文。`
 *   新: `- [~] **タイトル** [B] — 説明文。 — jobId \`xxxxxxxx\` startedAt 2026-04-27T07:00:00Z`
 */
export async function markInProgress(entry: PoolEntry, opts: MarkOptions): Promise<void> {
  const startedIso = (opts.startedAt ?? new Date()).toISOString();
  const newLine = replaceMarker(entry.rawLine, "~") +
    ` — jobId \`${opts.jobId}\` startedAt ${startedIso}`;
  await replaceLineByEntry(entry, newLine);
}

/**
 * `[✅]` に書き換え、jobId / channel / privacy / URL を含む完了行に整える。
 *   新: `- [✅] **タイトル** [B] — 説明文。 — jobId \`xxxxxxxx\` (rekishi / public) — https://youtube.com/shorts/...`
 *
 * 既存の startedAt 等の付帯情報は捨てて、確定情報のみで書き直す。
 */
export async function markDone(
  entry: PoolEntry,
  opts: { jobId: string; url: string; privacy?: string; channel?: string },
): Promise<void> {
  const baseDesc = stripTrailingMeta(entry.description);
  const channel = opts.channel ?? "rekishi";
  const privacy = opts.privacy ?? "public";
  const titlePart = `**${entry.title}**${entry.pattern ? ` [${entry.pattern}]` : ""}`;
  const newLine =
    `- [✅] ${titlePart} — ${baseDesc} — jobId \`${opts.jobId}\` (${channel} / ${privacy}) — ${opts.url}`;
  await replaceLineByEntry(entry, newLine);
}

/** `[~]` を `[ ]` に戻し、行末の jobId/startedAt 付帯情報を削除する。 */
export async function unlock(entry: PoolEntry): Promise<void> {
  const baseDesc = stripTrailingMeta(entry.description);
  const titlePart = `**${entry.title}**${entry.pattern ? ` [${entry.pattern}]` : ""}`;
  const newLine = `- [ ] ${titlePart} — ${baseDesc}`;
  await replaceLineByEntry(entry, newLine);
}

function replaceMarker(rawLine: string, marker: "~" | "✅" | " "): string {
  return rawLine.replace(/^- \[[ ~✅]\] /, `- [${marker}] `);
}

/**
 * description 末尾に `— jobId ...` や `— https://...` が付いていたら剥がす。
 * markDone / unlock で行を再構成する際に使う。
 */
function stripTrailingMeta(description: string): string {
  // 区切りは `—` (em dash)。最初に出てくる `— jobId` 以降を捨てる。
  const idx = description.search(/\s+—\s+jobId\s/);
  if (idx >= 0) return description.slice(0, idx).trim();
  return description.trim();
}

const POOL_LOCK_SUFFIX = ".lock";
const LOCK_RETRY_INTERVAL_MS = 5_000;
const LOCK_RETRY_COUNT = 6;

async function withPoolLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockFile = poolPath() + POOL_LOCK_SUFFIX;
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
        throw new Error(`topic-ideas-pool.md.lock を ${LOCK_RETRY_COUNT} 回リトライしても取得できませんでした`);
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_INTERVAL_MS));
    }
  }
  throw new Error("unreachable");
}

/**
 * pool ファイルから entry 該当行を特定して newLine に置換する。
 * 同一トピックを再 pop しないよう、特定は以下の優先順位で行う:
 *   1. lineNumber の行が rawLine と完全一致
 *   2. lineNumber の行が `**title**` を含む（マーカーが書き換わっていても可）
 *   3. ファイル全体から `**title**` を含む最初の行
 */
async function replaceLineByEntry(entry: PoolEntry, newLine: string): Promise<void> {
  await withPoolLock(async () => {
    const file = poolPath();
    const raw = await fs.readFile(file, "utf-8");
    const lines = raw.split("\n");

    const titleMarker = `**${entry.title}**`;
    let targetIdx = -1;

    if (entry.lineNumber >= 0 && entry.lineNumber < lines.length) {
      const candidate = lines[entry.lineNumber];
      if (candidate === entry.rawLine || (candidate && candidate.includes(titleMarker))) {
        targetIdx = entry.lineNumber;
      }
    }

    if (targetIdx < 0) {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l && l.includes(titleMarker)) {
          targetIdx = i;
          break;
        }
      }
    }

    if (targetIdx < 0) {
      throw new Error(
        `topic-ideas-pool.md の対象行が見つかりません (title=${entry.title})`,
      );
    }

    lines[targetIdx] = newLine;
    await fs.writeFile(file, lines.join("\n"), "utf-8");
  });
}
