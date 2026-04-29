import fs from "node:fs/promises";
import chalk from "chalk";
import { dataPath } from "../config.js";
import { StatsSnapshotSchema, type StatsSnapshot } from "./types.js";

export type SortKey = "views" | "likeRate" | "retention" | "subs" | "age" | "swipe";

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
  videoDurationSec: number | null;
  swipeRate3s: number | null;
  swipeRate10s: number | null;
  swipeRate50pct: number | null;
  hasRetention: boolean;
  retentionError: string | null;
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

// retention 情報は古いスナップショットには無い。最新で取れていなければ過去を遡る。
function findLatestRetention(snaps: StatsSnapshot[]): StatsSnapshot["retention"] | null {
  for (let i = snaps.length - 1; i >= 0; i--) {
    const s = snaps[i];
    if (s?.retention) return s.retention;
  }
  return null;
}

function toSummary(snaps: StatsSnapshot[]): VideoSummary {
  const latest = snaps[snaps.length - 1];
  if (!latest) throw new Error("toSummary: empty snapshots array");
  const prior = findClosest24hAgo(snaps, latest);
  const views = latest.statistics.viewCount;
  const likes = latest.statistics.likeCount;
  const retention = latest.retention ?? findLatestRetention(snaps);
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
    videoDurationSec: retention?.videoDurationSec ?? null,
    swipeRate3s: retention?.swipeRate3s ?? null,
    swipeRate10s: retention?.swipeRate10s ?? null,
    swipeRate50pct: retention?.swipeRate50pct ?? null,
    hasRetention: retention !== null,
    retentionError: latest.retentionError ?? null,
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
      case "swipe":
        // 低い方が良い（離脱が少ない）。null は末尾。
        return (a.swipeRate3s ?? 2) - (b.swipeRate3s ?? 2);
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
  // swipe rate は「低い方が良い」ので最小値を強調
  const minSwipe3s = (() => {
    let v: number | null = null;
    for (const r of rows) {
      if (r.swipeRate3s === null) continue;
      if (v === null || r.swipeRate3s < v) v = r.swipeRate3s;
    }
    return v;
  })();

  const colW = {
    rank: 3,
    title: 28,
    age: 5,
    views: 7,
    delta: 7,
    likeRate: 6,
    ret: 7,
    dur: 5,
    swipe3: 8,
    swipe10: 8,
    subs: 7,
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
    padVisual("Swipe3s", colW.swipe3) +
    " " +
    padVisual("Swipe10s", colW.swipe10) +
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
    const swipe3Raw = padVisual(fmtRate(r.swipeRate3s, 1), colW.swipe3);
    const swipe10Raw = padVisual(fmtRate(r.swipeRate10s, 1), colW.swipe10);
    const subsRaw = padVisual(
      r.subsPer1k !== null ? r.subsPer1k.toFixed(2) : "—",
      colW.subs,
    );

    const likeStr = topLike !== null && r.likeRate === topLike ? chalk.green(likeRaw) : likeRaw;
    const retStr =
      topRet !== null && r.viewPercentage === topRet ? chalk.green(retRaw) : retRaw;
    const subsStr =
      topSubs !== null && r.subsPer1k === topSubs && topSubs > 0 ? chalk.green(subsRaw) : subsRaw;
    const swipe3Str =
      minSwipe3s !== null && r.swipeRate3s === minSwipe3s
        ? chalk.green(swipe3Raw)
        : swipe3Raw;

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
        swipe3Str +
        " " +
        swipe10Raw +
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

  // Swipe rate サマリ: 全体平均 + 最良/最悪
  const swipe3sRows = rows.filter((r) => r.swipeRate3s !== null) as (VideoSummary & { swipeRate3s: number })[];
  if (swipe3sRows.length > 0) {
    const avg = swipe3sRows.reduce((a, b) => a + b.swipeRate3s, 0) / swipe3sRows.length;
    const best = [...swipe3sRows].sort((a, b) => a.swipeRate3s - b.swipeRate3s)[0]!;
    const worst = [...swipe3sRows].sort((a, b) => b.swipeRate3s - a.swipeRate3s)[0]!;
    out.push(
      chalk.dim(` Swipe@3s 平均: `) +
        fmtRate(avg, 1) +
        chalk.dim(`  | 最良: `) +
        chalk.green(fmtRate(best.swipeRate3s, 1)) +
        chalk.dim(` (${shortTitle(best.title)})`) +
        chalk.dim(`  | 最悪: `) +
        chalk.red(fmtRate(worst.swipeRate3s, 1)) +
        chalk.dim(` (${shortTitle(worst.title)})`),
    );
  }
  const pendingRetention = rows.filter((r) => !r.hasRetention && r.views > 0);
  if (pendingRetention.length > 0) {
    out.push(
      chalk.dim(` ℹ Retention待ち: ${pendingRetention.length}本（投稿後 数日〜 で反映 / 視聴数不足だと取れない）`),
    );
  }

  return out.join("\n");
}
