import { google } from "googleapis";
import { createAuthClient } from "../youtube/auth.js";
import type { StatsSnapshot, VideoAnalytics, VideoStatistics } from "./types.js";
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

export async function fetchStatsForVideos(uploads: UploadLogEntry[]): Promise<StatsSnapshot[]> {
  if (uploads.length === 0) return [];
  const auth = createAuthClient();
  const dataApi = google.youtube({ version: "v3", auth });
  const analyticsApi = google.youtubeAnalytics({ version: "v2", auth });

  // Data API: 最大50件まで一括取得
  const ids = uploads.map((u) => u.videoId);
  const statsById = new Map<string, VideoStatistics>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data } = await dataApi.videos.list({
      part: ["statistics"],
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

    try {
      const startDate = yyyymmdd(up.uploadedAt);
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
        // データ無し（公開直後など）。ゼロで埋める
        analytics = {
          views: 0,
          estimatedMinutesWatched: 0,
          averageViewDuration: 0,
          averageViewPercentage: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          subscribersGained: 0,
          subscribersLost: 0,
        };
      }
    } catch (err) {
      analyticsError = err instanceof Error ? err.message : String(err);
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
    });
  }

  return snapshots;
}
