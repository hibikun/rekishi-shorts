import fs from "node:fs/promises";
import chalk from "chalk";
import { dataPath } from "../config.js";
import { StatsSnapshotSchema, type StatsSnapshot } from "./types.js";

export type SortKey = "views" | "likeRate" | "retention" | "subs" | "age";

export interface VideoSummary {
  videoId: string;
  jobId: string;
  title: string;
  privacy: StatsSnapshot["privacy"];
  ageHours: number;
  views: number;
  likes: number;
  comments: number;
  likeRate: number | null;
  deltaViews24h: number | null;
  viewPercentage: number | null;
  avgDuration: number | null;
  subsPer1k: number | null;
  hasAnalytics: boolean;
  analyticsError: string | null;
  latestFetchedAt: string;
}

export async function readAllSnapshots(): Promise<StatsSnapshot[]> {
  const file = dataPath("analytics", "snapshots.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim());
  return lines.map((l) => StatsSnapshotSchema.parse(JSON.parse(l)));
}

function groupByVideo(snapshots: StatsSnapshot[]): Map<string, StatsSnapshot[]> {
  const map = new Map<string, StatsSnapshot[]>();
  for (const s of snapshots) {
    const arr = map.get(s.videoId) ?? [];
    arr.push(s);
    map.set(s.videoId, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
  }
  return map;
}

function findClosest24hAgo(snaps: StatsSnapshot[], latest: StatsSnapshot): StatsSnapshot | null {
  const latestT = new Date(latest.fetchedAt).getTime();
  const target = latestT - 24 * 3600_000;
  const window = 6 * 3600_000;
  let best: StatsSnapshot | null = null;
  let bestDist = Infinity;
  for (const s of snaps) {
    if (s === latest) continue;
    const t = new Date(s.fetchedAt).getTime();
    const d = Math.abs(t - target);
    if (d < bestDist && d <= window) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

function toSummary(snaps: StatsSnapshot[]): VideoSummary {
  const latest = snaps[snaps.length - 1];
  if (!latest) throw new Error("toSummary: empty snapshots array");
  const prior = findClosest24hAgo(snaps, latest);
  const views = latest.statistics.viewCount;
  const likes = latest.statistics.likeCount;
  return {
    videoId: latest.videoId,
    jobId: latest.jobId,
    title: latest.title,
    privacy: latest.privacy,
    ageHours: latest.ageHours,
    views,
    likes,
    comments: latest.statistics.commentCount,
    likeRate: views > 0 ? likes / views : null,
    deltaViews24h: prior ? views - prior.statistics.viewCount : null,
    viewPercentage: latest.analytics?.averageViewPercentage ?? null,
    avgDuration: latest.analytics?.averageViewDuration ?? null,
    subsPer1k:
      latest.analytics && views > 0
        ? (latest.analytics.subscribersGained / views) * 1000
        : null,
    hasAnalytics: latest.analytics !== null,
    analyticsError: latest.analyticsError ?? null,
    latestFetchedAt: latest.fetchedAt,
  };
}

export interface BuildSummaryOptions {
  sort?: SortKey;
  minAgeHours?: number;
}

export async function buildSummary(opts: BuildSummaryOptions = {}): Promise<VideoSummary[]> {
  const snaps = await readAllSnapshots();
  const grouped = groupByVideo(snaps);
  let list: VideoSummary[] = [];
  for (const arr of grouped.values()) {
    list.push(toSummary(arr));
  }
  if (opts.minAgeHours !== undefined) {
    list = list.filter((v) => v.ageHours >= opts.minAgeHours!);
  }
  const sort = opts.sort ?? "views";
  list.sort((a, b) => {
    switch (sort) {
      case "likeRate":
        return (b.likeRate ?? -1) - (a.likeRate ?? -1);
      case "retention":
        return (b.viewPercentage ?? -1) - (a.viewPercentage ?? -1);
      case "subs":
        return (b.subsPer1k ?? -1) - (a.subsPer1k ?? -1);
      case "age":
        return a.ageHours - b.ageHours;
      case "views":
      default:
        return b.views - a.views;
    }
  });
  return list;
}

function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += (ch.codePointAt(0) ?? 0) > 0x7f ? 2 : 1;
  }
  return w;
}

function padVisual(s: string, width: number): string {
  const diff = width - visualWidth(s);
  return diff > 0 ? s + " ".repeat(diff) : s;
}

function truncateVisual(s: string, width: number): string {
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = (ch.codePointAt(0) ?? 0) > 0x7f ? 2 : 1;
    if (w + cw > width - 1) {
      return padVisual(out + "…", width);
    }
    w += cw;
    out += ch;
  }
  return padVisual(out, width);
}

function shortTitle(full: string): string {
  return full.replace(/\s*#Shorts\s*$/u, "").trim();
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtRate(r: number | null, digits = 2): string {
  return r === null ? "—" : (r * 100).toFixed(digits) + "%";
}

function fmtDelta(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "±0";
  return (n > 0 ? "+" : "") + fmtInt(n);
}

function pickMax(rows: VideoSummary[], f: (r: VideoSummary) => number | null): number | null {
  let max: number | null = null;
  for (const r of rows) {
    const v = f(r);
    if (v === null) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

export function renderSummaryTable(rows: VideoSummary[], opts: { now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const stamp = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const out: string[] = [];
  out.push(chalk.bold(`📊 Stats Summary  (${stamp}  N=${rows.length})`));
  out.push("");

  if (rows.length === 0) {
    out.push(chalk.yellow("⚠ snapshots.jsonl にデータがありません。まず `pnpm post stats` を実行してください。"));
    return out.join("\n");
  }

  const topLike = pickMax(rows, (r) => r.likeRate);
  const topRet = pickMax(rows, (r) => r.viewPercentage);
  const topSubs = pickMax(rows, (r) => r.subsPer1k);

  const colW = {
    rank: 3,
    title: 30,
    age: 5,
    views: 7,
    delta: 7,
    likeRate: 7,
    ret: 8,
    dur: 6,
    subs: 8,
  };

  const head =
    padVisual(" # ", colW.rank) +
    " " +
    padVisual("Title", colW.title) +
    " " +
    padVisual("Age", colW.age) +
    " " +
    padVisual("Views", colW.views) +
    " " +
    padVisual("Δ24h", colW.delta) +
    " " +
    padVisual("👍率", colW.likeRate) +
    " " +
    padVisual("視聴率", colW.ret) +
    " " +
    padVisual("平均s", colW.dur) +
    " " +
    padVisual("登録/1k", colW.subs);
  out.push(chalk.dim(head));

  rows.forEach((r, i) => {
    const rank = padVisual(String(i + 1).padStart(2) + " ", colW.rank);
    const title = truncateVisual(shortTitle(r.title), colW.title);
    const ageStr = padVisual((r.ageHours / 24).toFixed(1) + "d", colW.age);
    const viewsStr = padVisual(fmtInt(r.views), colW.views);
    const deltaRaw = fmtDelta(r.deltaViews24h);
    const deltaStr = padVisual(deltaRaw, colW.delta);
    const likeRaw = padVisual(fmtRate(r.likeRate), colW.likeRate);
    const retRaw = padVisual(
      r.viewPercentage !== null ? r.viewPercentage.toFixed(1) + "%" : "—",
      colW.ret,
    );
    const durRaw = padVisual(
      r.avgDuration !== null ? r.avgDuration.toFixed(0) + "s" : "—",
      colW.dur,
    );
    const subsRaw = padVisual(
      r.subsPer1k !== null ? r.subsPer1k.toFixed(2) : "—",
      colW.subs,
    );

    const likeStr = topLike !== null && r.likeRate === topLike ? chalk.green(likeRaw) : likeRaw;
    const retStr =
      topRet !== null && r.viewPercentage === topRet ? chalk.green(retRaw) : retRaw;
    const subsStr =
      topSubs !== null && r.subsPer1k === topSubs && topSubs > 0 ? chalk.green(subsRaw) : subsRaw;

    const zeroDim = r.views === 0 ? chalk.dim : (x: string) => x;

    out.push(
      zeroDim(
        rank +
          " " +
          title +
          " " +
          ageStr +
          " " +
          viewsStr +
          " " +
          deltaStr +
          " ",
      ) +
        likeStr +
        " " +
        retStr +
        " " +
        durRaw +
        " " +
        subsStr,
    );
  });

  out.push("");

  const topLikeRows = topLike !== null ? rows.filter((r) => r.likeRate === topLike) : [];
  const topRetRows = topRet !== null ? rows.filter((r) => r.viewPercentage === topRet) : [];
  if (topLikeRows.length > 0) {
    out.push(
      chalk.dim(" TOP 👍率: ") +
        topLikeRows.map((r) => shortTitle(r.title)).join(" / ") +
        chalk.dim(`  (${fmtRate(topLike)})`),
    );
  }
  if (topRetRows.length > 0 && topRet !== null) {
    out.push(
      chalk.dim(" TOP 視聴率: ") +
        topRetRows.map((r) => shortTitle(r.title)).join(" / ") +
        chalk.dim(`  (${topRet.toFixed(1)}%)`),
    );
  }
  const zeroRows = rows.filter((r) => r.views === 0);
  if (zeroRows.length > 0) {
    out.push(
      chalk.yellow(" ⚠ 再生0: ") + zeroRows.map((r) => shortTitle(r.title)).join(" / "),
    );
  }
  const pendingAnalytics = rows.filter((r) => !r.hasAnalytics && r.views > 0);
  if (pendingAnalytics.length > 0) {
    out.push(
      chalk.dim(` ℹ Analytics待ち: ${pendingAnalytics.length}本（投稿24〜72h後に反映）`),
    );
  }
  if ((topRet ?? 0) > 100) {
    out.push(chalk.dim(" * 視聴率100%超 = ループ視聴分を含む"));
  }

  return out.join("\n");
}
