import fs from "node:fs/promises";
import path from "node:path";
import { channelPackageDir } from "@rekishi/shared/channel";

export type TopicStatus = "available" | "in-progress" | "done";

export interface TopicPoolEntry {
  /** 行全体（書き戻し時に置換するために保持） */
  rawLine: string;
  status: TopicStatus;
  slug: string;
  title: string;
  /** その行が属する `## カテゴリ` の見出し */
  category: string;
  jobId?: string;
  url?: string;
}

export function topicPoolPath(): string {
  return path.join(channelPackageDir("ukiyoe"), "topic-pool.md");
}

const ENTRY_PATTERN =
  /^- \[(?<status>[ ~✅])\] `(?<slug>[a-z0-9-]+)` (?<rest>.+)$/;

function parseStatus(marker: string): TopicStatus {
  if (marker === "✅") return "done";
  if (marker === "~") return "in-progress";
  return "available";
}

function statusMarker(status: TopicStatus): string {
  if (status === "done") return "✅";
  if (status === "in-progress") return "~";
  return " ";
}

export async function readTopicPool(): Promise<TopicPoolEntry[]> {
  const raw = await fs.readFile(topicPoolPath(), "utf-8");
  const lines = raw.split("\n");
  const entries: TopicPoolEntry[] = [];
  let category = "";
  for (const line of lines) {
    if (line.startsWith("## ")) {
      category = line.slice(3).trim();
      continue;
    }
    const m = ENTRY_PATTERN.exec(line);
    if (!m || !m.groups) continue;
    const statusRaw = m.groups.status ?? " ";
    const slug = m.groups.slug ?? "";
    const rest = m.groups.rest ?? "";
    // rest 例: "宮本武蔵 巌流島の決闘の1日 — ukiyoe-musashi-2026-04-26 — https://youtube.com/shorts/xxx"
    const parts = rest.split(" — ").map((s) => s.trim());
    const title = parts[0] ?? "";
    const jobId = parts[1];
    const url = parts[2];
    entries.push({
      rawLine: line,
      status: parseStatus(statusRaw),
      slug,
      title,
      category,
      jobId,
      url,
    });
  }
  return entries;
}

export async function listAvailableTopics(limit = 5): Promise<TopicPoolEntry[]> {
  const entries = await readTopicPool();
  return entries.filter((e) => e.status === "available").slice(0, limit);
}

export async function findTopicBySlug(slug: string): Promise<TopicPoolEntry | undefined> {
  const entries = await readTopicPool();
  return entries.find((e) => e.slug === slug);
}

/** 該当 slug 行を新しいステータスに書き換える（jobId / url も任意で追記） */
export async function updateTopicStatus(
  slug: string,
  status: TopicStatus,
  jobId?: string,
  url?: string,
): Promise<void> {
  const file = topicPoolPath();
  const raw = await fs.readFile(file, "utf-8");
  const lines = raw.split("\n");
  let replaced = false;
  const next = lines.map((line) => {
    const m = ENTRY_PATTERN.exec(line);
    if (!m || !m.groups || m.groups.slug !== slug) return line;
    replaced = true;
    const rest = m.groups.rest ?? "";
    const title = rest.split(" — ")[0]?.trim() ?? "";
    const tail: string[] = [];
    if (jobId) tail.push(jobId);
    if (url) tail.push(url);
    const suffix = tail.length > 0 ? ` — ${tail.join(" — ")}` : "";
    return `- [${statusMarker(status)}] \`${slug}\` ${title}${suffix}`;
  });
  if (!replaced) {
    throw new Error(`topic-pool に slug=${slug} が見つかりません`);
  }
  await fs.writeFile(file, next.join("\n"), "utf-8");
}
