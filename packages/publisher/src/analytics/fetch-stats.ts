import { google } from "googleapis";
import { createAuthClient } from "../youtube/auth.js";
import type {
  RetentionCurve,
  RetentionPoint,
  StatsSnapshot,
  VideoAnalytics,
  VideoStatistics,
} from "./types.js";
import type { UploadLogEntry } from "../index.js";

const ANALYTICS_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost",
] as const;

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function yyyymmdd(iso: string): string {
  return iso.slice(0, 10);
}

// ISO 8601 duration (PT1M5S, PT58S, PT1H2M3S) → seconds
function parseIsoDuration(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + s;
}

// 視聴維持カーブの指定 ratio 地点の watchRatio を線形補間で取得
function watchRatioAt(points: RetentionPoint[], targetRatio: number): number | null {
  if (points.length === 0) return null;
  if (targetRatio <= 0) targetRatio = 0;
  if (targetRatio >= 1) targetRatio = 1;
  // points は ratio 昇順想定
  let prev = points[0]!;
  if (targetRatio <= prev.ratio) return prev.watchRatio;
  for (let i = 1; i < points.length; i++) {
    const cur = points[i]!;
    if (cur.ratio >= targetRatio) {
      const span = cur.ratio - prev.ratio;
      const t = span === 0 ? 0 : (targetRatio - prev.ratio) / span;
      return prev.watchRatio + (cur.watchRatio - prev.watchRatio) * t;
    }
    prev = cur;
  }
  return prev.watchRatio;
}

// audienceWatchRatio は「平均視聴回数比」（ループ視聴で 1 超もあり得る）。
// → 序盤の値を 100% とみなし、その地点での相対視聴維持率を出す。
//   swipeRate = 1 - (watchRatio[t] / baseline)
function relativeSwipeRate(
  points: RetentionPoint[],
  targetRatio: number,
  baseline: number | null,
): number | null {
  if (points.length === 0 || baseline === null || baseline <= 0) return null;
  const wr = watchRatioAt(points, targetRatio);
  if (wr === null) return null;
  return Math.max(0, Math.min(1, 1 - wr / baseline));
}

export async function fetchStatsForVideos(uploads: UploadLogEntry[]): Promise<StatsSnapshot[]> {
  if (uploads.length === 0) return [];
  const auth = createAuthClient();
  const dataApi = google.youtube({ version: "v3", auth });
  const analyticsApi = google.youtubeAnalytics({ version: "v2", auth });

  // Data API: 最大50件まで一括取得（statistics + contentDetails）
  const ids = uploads.map((u) => u.videoId);
  const statsById = new Map<string, VideoStatistics>();
  const durationById = new Map<string, number | null>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data } = await dataApi.videos.list({
      part: ["statistics", "contentDetails"],
      id: chunk,
      maxResults: 50,
    });
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      const s = item.statistics ?? {};
      statsById.set(item.id, {
        viewCount: toNumber(s.viewCount),
        likeCount: toNumber(s.likeCount),
        commentCount: toNumber(s.commentCount),
        favoriteCount: toNumber(s.favoriteCount),
      });
      durationById.set(item.id, parseIsoDuration(item.contentDetails?.duration));
    }
  }

  const now = new Date();
  const fetchedAt = now.toISOString();
  const endDate = yyyymmdd(fetchedAt);

  const snapshots: StatsSnapshot[] = [];

  // Analytics API: 動画ごとに1リクエスト
  for (const up of uploads) {
    const statistics = statsById.get(up.videoId) ?? {
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      favoriteCount: 0,
    };
    const ageHours = (now.getTime() - new Date(up.uploadedAt).getTime()) / 3_600_000;
    let analytics: VideoAnalytics | null = null;
    let analyticsError: string | undefined;
    let retention: RetentionCurve | null = null;
    let retentionError: string | undefined;
    const startDate = yyyymmdd(up.uploadedAt);
    const videoDurationSec = durationById.get(up.videoId) ?? null;

    try {
      const { data } = await analyticsApi.reports.query({
        ids: "channel==MINE",
        startDate,
        endDate,
        metrics: ANALYTICS_METRICS.join(","),
        filters: `video==${up.videoId}`,
      });
      const headers = data.columnHeaders ?? [];
      const row = (data.rows ?? [])[0];
      if (row) {
        const values: Record<string, number> = {};
        headers.forEach((h, idx) => {
          if (h.name) values[h.name] = toNumber(row[idx]);
        });
        analytics = {
          views: values.views ?? 0,
          estimatedMinutesWatched: values.estimatedMinutesWatched ?? 0,
          averageViewDuration: values.averageViewDuration ?? 0,
          averageViewPercentage: values.averageViewPercentage ?? 0,
          likes: values.likes ?? 0,
          comments: values.comments ?? 0,
          shares: values.shares ?? 0,
          subscribersGained: values.subscribersGained ?? 0,
          subscribersLost: values.subscribersLost ?? 0,
        };
      } else {
        // Analytics API は動画ごと24〜72時間のラグがある。rows 空は「まだ集計前」のサイン。
        analyticsError = "no rows (集計ラグの可能性 / 通常24〜72時間後に反映)";
      }
    } catch (err) {
      analyticsError = err instanceof Error ? err.message : String(err);
    }

    // 視聴維持カーブ: dimensions=elapsedVideoTimeRatio, metrics=audienceWatchRatio
    // → 100 ポイント程度の retention 曲線が返る。0% 地点からの落ち幅 = swipe rate。
    try {
      const { data } = await analyticsApi.reports.query({
        ids: "channel==MINE",
        startDate,
        endDate,
        metrics: "audienceWatchRatio",
        dimensions: "elapsedVideoTimeRatio",
        filters: `video==${up.videoId}`,
        sort: "elapsedVideoTimeRatio",
      });
      const rows = data.rows ?? [];
      if (rows.length > 0) {
        const points: RetentionPoint[] = rows
          .map((r) => ({
            ratio: toNumber(r[0]),
            watchRatio: toNumber(r[1]),
          }))
          .sort((a, b) => a.ratio - b.ratio);
        // 序盤 (1-2%) を 100% 視聴とみなしてベースラインに
        const baseline = points[0]?.watchRatio ?? null;
        const swipeRate3s =
          videoDurationSec && videoDurationSec > 0
            ? relativeSwipeRate(points, 3 / videoDurationSec, baseline)
            : null;
        const swipeRate10s =
          videoDurationSec && videoDurationSec > 0
            ? relativeSwipeRate(points, 10 / videoDurationSec, baseline)
            : null;
        const swipeRate50pct = relativeSwipeRate(points, 0.5, baseline);
        retention = {
          videoDurationSec,
          points,
          swipeRate3s,
          swipeRate10s,
          swipeRate50pct,
        };
      } else {
        retentionError = "no retention rows (集計ラグ or 視聴数不足)";
      }
    } catch (err) {
      retentionError = err instanceof Error ? err.message : String(err);
    }

    snapshots.push({
      fetchedAt,
      videoId: up.videoId,
      jobId: up.jobId,
      title: up.title,
      uploadedAt: up.uploadedAt,
      privacy: up.privacy,
      ageHours: Math.round(ageHours * 10) / 10,
      statistics,
      analytics,
      analyticsError,
      retention,
      retentionError,
    });
  }

  return snapshots;
}
