import { z } from "zod";

export const VideoStatisticsSchema = z.object({
  viewCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  favoriteCount: z.number().int().nonnegative(),
});
export type VideoStatistics = z.infer<typeof VideoStatisticsSchema>;

export const VideoAnalyticsSchema = z.object({
  views: z.number().nonnegative(),
  estimatedMinutesWatched: z.number().nonnegative(),
  averageViewDuration: z.number().nonnegative(),
  averageViewPercentage: z.number().nonnegative(),
  likes: z.number().nonnegative(),
  comments: z.number().nonnegative(),
  shares: z.number().nonnegative(),
  subscribersGained: z.number().nonnegative(),
  subscribersLost: z.number().nonnegative(),
});
export type VideoAnalytics = z.infer<typeof VideoAnalyticsSchema>;

export const RetentionPointSchema = z.object({
  ratio: z.number().min(0),
  watchRatio: z.number().min(0),
});
export type RetentionPoint = z.infer<typeof RetentionPointSchema>;

export const RetentionCurveSchema = z.object({
  videoDurationSec: z.number().nonnegative().nullable(),
  points: z.array(RetentionPointSchema),
  swipeRate3s: z.number().nullable(),
  swipeRate10s: z.number().nullable(),
  swipeRate50pct: z.number().nullable(),
});
export type RetentionCurve = z.infer<typeof RetentionCurveSchema>;

export const StatsSnapshotSchema = z.object({
  fetchedAt: z.string(),
  videoId: z.string(),
  jobId: z.string(),
  title: z.string(),
  uploadedAt: z.string(),
  privacy: z.enum(["public", "unlisted", "private"]),
  ageHours: z.number().nonnegative(),
  statistics: VideoStatisticsSchema,
  analytics: VideoAnalyticsSchema.nullable(),
  analyticsError: z.string().optional(),
  retention: RetentionCurveSchema.nullable().optional(),
  retentionError: z.string().optional(),
});
export type StatsSnapshot = z.infer<typeof StatsSnapshotSchema>;
