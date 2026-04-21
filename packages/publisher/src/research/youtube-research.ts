import { google, type youtube_v3 } from "googleapis";
import { createAuthClient } from "../youtube/auth.js";

export interface ResearchOptions {
  queries: string[];
  /** 検索から拾うチャンネル候補の上限（最終的な分析対象はここから絞り込む） */
  channelCandidateLimit: number;
  /** 最終的に深掘りするチャンネル数 */
  topChannels: number;
  /** 各チャンネルから直近何本のアップロードを見るか（playlistItems） */
  recentUploadsPerChannel: number;
  /** Shorts 判定の最大秒数 */
  shortsMaxDurationSec: number;
  /** 直近何日以内のアップロードを集計対象にするか */
  windowDays: number;
  /** チャンネル title/description に含まれていれば「歴史系」とみなすキーワード（OR 判定） */
  historyKeywords?: string[];
  /** 進捗を stderr に流すコールバック */
  onLog?: (msg: string) => void;
}

const DEFAULT_HISTORY_KEYWORDS = [
  "歴史", "日本史", "世界史", "戦国", "幕末", "江戸", "明治", "武将", "偉人",
  "古代", "中世", "近世", "近代", "王朝", "帝国", "三国", "大戦", "合戦",
  "history", "historical",
];

function channelMatchesHistory(c: ChannelSummary, keywords: string[]): boolean {
  const haystack = `${c.title} ${c.description ?? ""}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}

export interface ChannelSummary {
  channelId: string;
  title: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  uploadsPlaylistId: string;
  country?: string;
  description?: string;
}

export interface ShortVideo {
  videoId: string;
  url: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  ageDays: number;
  durationSec: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  viewsPerDay: number;
  tags: string[];
  thumbnail?: string;
}

export interface ResearchResult {
  generatedAt: string;
  queries: string[];
  channelsAnalyzed: ChannelSummary[];
  shorts: ShortVideo[];
  quotaEstimate: number;
}

const ISO_DURATION_REGEX = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

function parseIsoDurationSec(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = ISO_DURATION_REGEX.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(min ?? 0) * 60) + Number(s ?? 0);
}

function toInt(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function daysBetween(from: string, to: Date): number {
  const diffMs = to.getTime() - new Date(from).getTime();
  return Math.max(0, diffMs / 86_400_000);
}

type YouTubeClient = ReturnType<typeof google.youtube>;

async function searchChannelCandidates(
  yt: YouTubeClient,
  queries: string[],
  candidateLimit: number,
  log: (m: string) => void,
): Promise<{ channelIds: Set<string>; quota: number }> {
  const channelIds = new Set<string>();
  let quota = 0;
  for (const q of queries) {
    log(`   🔎 search: "${q}"`);
    // videoDuration=short は4分以下だが、チャンネル候補抽出目的なので十分
    const { data } = await yt.search.list({
      part: ["snippet"],
      q,
      type: ["video"],
      videoDuration: "short",
      maxResults: 50,
      regionCode: "JP",
      relevanceLanguage: "ja",
      order: "viewCount",
    });
    quota += 100; // search.list は 100 units
    for (const item of data.items ?? []) {
      const cid = item.snippet?.channelId;
      if (cid) channelIds.add(cid);
      if (channelIds.size >= candidateLimit) break;
    }
    if (channelIds.size >= candidateLimit) break;
  }
  return { channelIds, quota };
}

async function fetchChannelSummaries(
  yt: YouTubeClient,
  channelIds: string[],
): Promise<{ summaries: ChannelSummary[]; quota: number }> {
  const summaries: ChannelSummary[] = [];
  let quota = 0;
  for (let i = 0; i < channelIds.length; i += 50) {
    const chunk = channelIds.slice(i, i + 50);
    const { data } = await yt.channels.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: chunk,
      maxResults: 50,
    });
    quota += 1;
    for (const c of data.items ?? []) {
      const uploads = c.contentDetails?.relatedPlaylists?.uploads;
      if (!c.id || !uploads) continue;
      summaries.push({
        channelId: c.id,
        title: c.snippet?.title ?? "(no title)",
        subscriberCount: toInt(c.statistics?.subscriberCount),
        viewCount: toInt(c.statistics?.viewCount),
        videoCount: toInt(c.statistics?.videoCount),
        uploadsPlaylistId: uploads,
        country: c.snippet?.country ?? undefined,
        description: c.snippet?.description ?? undefined,
      });
    }
  }
  return { summaries, quota };
}

async function fetchRecentUploads(
  yt: YouTubeClient,
  uploadsPlaylistId: string,
  limit: number,
): Promise<{ videoIds: string[]; quota: number }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let quota = 0;
  while (ids.length < limit) {
    const remaining = limit - ids.length;
    const { data } = await yt.playlistItems.list({
      part: ["contentDetails"],
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(50, remaining),
      pageToken,
    });
    quota += 1;
    for (const item of data.items ?? []) {
      const vid = item.contentDetails?.videoId;
      if (vid) ids.push(vid);
    }
    if (!data.nextPageToken || (data.items ?? []).length === 0) break;
    pageToken = data.nextPageToken;
  }
  return { videoIds: ids, quota };
}

async function fetchVideoDetails(
  yt: YouTubeClient,
  videoIds: string[],
): Promise<{ videos: youtube_v3.Schema$Video[]; quota: number }> {
  const videos: youtube_v3.Schema$Video[] = [];
  let quota = 0;
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const { data } = await yt.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: chunk,
      maxResults: 50,
    });
    quota += 1;
    for (const v of data.items ?? []) videos.push(v);
  }
  return { videos, quota };
}

function toShortVideo(v: youtube_v3.Schema$Video, channelTitle: string, now: Date): ShortVideo | null {
  if (!v.id) return null;
  const publishedAt = v.snippet?.publishedAt;
  const durationSec = parseIsoDurationSec(v.contentDetails?.duration);
  if (!publishedAt || durationSec <= 0) return null;
  const ageDays = daysBetween(publishedAt, now);
  const viewCount = toInt(v.statistics?.viewCount);
  return {
    videoId: v.id,
    url: `https://www.youtube.com/shorts/${v.id}`,
    title: v.snippet?.title ?? "",
    description: v.snippet?.description ?? "",
    channelId: v.snippet?.channelId ?? "",
    channelTitle,
    publishedAt,
    ageDays: Math.round(ageDays * 10) / 10,
    durationSec,
    viewCount,
    likeCount: toInt(v.statistics?.likeCount),
    commentCount: toInt(v.statistics?.commentCount),
    viewsPerDay: ageDays > 0 ? Math.round(viewCount / ageDays) : viewCount,
    tags: v.snippet?.tags ?? [],
    thumbnail: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? undefined,
  };
}

export async function runResearch(options: ResearchOptions): Promise<ResearchResult> {
  const log = options.onLog ?? (() => {});
  const auth = createAuthClient();
  const yt = google.youtube({ version: "v3", auth });
  const now = new Date();
  let totalQuota = 0;

  log("🔍 1/4 候補チャンネル探索");
  const { channelIds, quota: qSearch } = await searchChannelCandidates(
    yt,
    options.queries,
    options.channelCandidateLimit,
    log,
  );
  totalQuota += qSearch;
  log(`   候補 ${channelIds.size} チャンネル (quota+${qSearch})`);

  log("📦 2/4 チャンネル情報取得");
  const { summaries, quota: qChan } = await fetchChannelSummaries(yt, Array.from(channelIds));
  totalQuota += qChan;

  const historyKeywords = options.historyKeywords ?? DEFAULT_HISTORY_KEYWORDS;
  const historyFiltered = summaries.filter((c) => channelMatchesHistory(c, historyKeywords));
  log(`   歴史キーワードで絞込: ${summaries.length} → ${historyFiltered.length}`);

  // 登録者数が極端に少ないチャンネルを除外し、上位 topChannels を深掘り対象にする
  const ranked = historyFiltered
    .filter((c) => c.subscriberCount >= 1000 && c.videoCount >= 5)
    .sort((a, b) => b.subscriberCount - a.subscriberCount)
    .slice(0, options.topChannels);
  log(`   深掘り ${ranked.length} チャンネル (quota+${qChan})`);

  log("📜 3/4 各チャンネルの直近アップロード取得");
  const allVideoIds: { id: string; channelTitle: string }[] = [];
  for (const ch of ranked) {
    const { videoIds, quota: qPl } = await fetchRecentUploads(yt, ch.uploadsPlaylistId, options.recentUploadsPerChannel);
    totalQuota += qPl;
    for (const id of videoIds) allVideoIds.push({ id, channelTitle: ch.title });
    log(`   ${ch.title}: ${videoIds.length}本 (quota+${qPl})`);
  }

  log("🎬 4/4 動画詳細取得");
  const { videos, quota: qVid } = await fetchVideoDetails(yt, allVideoIds.map((v) => v.id));
  totalQuota += qVid;
  log(`   取得 ${videos.length}本 (quota+${qVid})`);

  const channelTitleById = new Map(ranked.map((c) => [c.channelId, c.title]));
  const cutoff = now.getTime() - options.windowDays * 86_400_000;

  const shorts: ShortVideo[] = [];
  for (const v of videos) {
    const cid = v.snippet?.channelId ?? "";
    const title = channelTitleById.get(cid) ?? v.snippet?.channelTitle ?? "";
    const sv = toShortVideo(v, title, now);
    if (!sv) continue;
    if (sv.durationSec > options.shortsMaxDurationSec) continue;
    if (new Date(sv.publishedAt).getTime() < cutoff) continue;
    shorts.push(sv);
  }

  shorts.sort((a, b) => b.viewCount - a.viewCount);

  return {
    generatedAt: now.toISOString(),
    queries: options.queries,
    channelsAnalyzed: ranked,
    shorts,
    quotaEstimate: totalQuota,
  };
}
