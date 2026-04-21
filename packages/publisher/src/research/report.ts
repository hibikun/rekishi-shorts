import type { ResearchResult, ShortVideo, ChannelSummary } from "./youtube-research.js";

function num(n: number): string {
  return n.toLocaleString("en-US");
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function toYMD(iso: string): string {
  return iso.slice(0, 10);
}

function channelLine(c: ChannelSummary, shortsOfChannel: ShortVideo[]): string {
  const totalViews = shortsOfChannel.reduce((s, v) => s + v.viewCount, 0);
  const avg = shortsOfChannel.length > 0 ? Math.round(totalViews / shortsOfChannel.length) : 0;
  return `| [${esc(c.title)}](https://www.youtube.com/channel/${c.channelId}) | ${num(c.subscriberCount)} | ${num(c.videoCount)} | ${shortsOfChannel.length} | ${num(totalViews)} | ${num(avg)} |`;
}

function shortRow(v: ShortVideo, rank: number): string {
  return `| ${rank} | [${esc(truncate(v.title, 60))}](${v.url}) | ${esc(truncate(v.channelTitle, 20))} | ${num(v.viewCount)} | ${num(v.viewsPerDay)} | ${num(v.likeCount)} | ${num(v.commentCount)} | ${v.durationSec}s | ${toYMD(v.publishedAt)} |`;
}

export function renderMarkdownReport(result: ResearchResult, params: { windowDays: number }): string {
  const { shorts, channelsAnalyzed } = result;
  const lines: string[] = [];

  const generated = toYMD(result.generatedAt);
  lines.push(`# 競合YouTube Shortsリサーチ (${generated})`);
  lines.push("");
  lines.push(`- 対象期間: 直近 **${params.windowDays}日**`);
  lines.push(`- 分析チャンネル数: **${channelsAnalyzed.length}**`);
  lines.push(`- 集計 Shorts: **${shorts.length}本**`);
  lines.push(`- 検索クエリ: ${result.queries.map((q) => `\`${q}\``).join(", ")}`);
  lines.push(`- APIクォータ消費概算: ${result.quotaEstimate} units`);
  lines.push("");

  // ▼ エグゼクティブサマリ: 全体Top20
  lines.push("## 🏆 全体 Top 20 Shorts（再生数順）");
  lines.push("");
  lines.push("| # | タイトル | チャンネル | 再生数 | /day | 👍 | 💬 | 尺 | 投稿日 |");
  lines.push("| - | - | - | -: | -: | -: | -: | -: | - |");
  shorts.slice(0, 20).forEach((v, i) => lines.push(shortRow(v, i + 1)));
  lines.push("");

  // ▼ バズ速度 Top 10（viewsPerDay）
  const byVelocity = [...shorts].sort((a, b) => b.viewsPerDay - a.viewsPerDay).slice(0, 10);
  lines.push("## 🚀 バズ速度 Top 10（再生数/日）");
  lines.push("");
  lines.push("| # | タイトル | チャンネル | /day | 合計再生 | 経過日 | 投稿日 |");
  lines.push("| - | - | - | -: | -: | -: | - |");
  byVelocity.forEach((v, i) => {
    lines.push(`| ${i + 1} | [${esc(truncate(v.title, 60))}](${v.url}) | ${esc(truncate(v.channelTitle, 20))} | ${num(v.viewsPerDay)} | ${num(v.viewCount)} | ${v.ageDays} | ${toYMD(v.publishedAt)} |`);
  });
  lines.push("");

  // ▼ チャンネル別サマリ
  const byChannel = new Map<string, ShortVideo[]>();
  for (const s of shorts) {
    const arr = byChannel.get(s.channelId) ?? [];
    arr.push(s);
    byChannel.set(s.channelId, arr);
  }

  lines.push("## 📺 分析対象チャンネル一覧");
  lines.push("");
  lines.push("| チャンネル | 登録者 | 総動画 | 期間内Shorts | 期間内合計再生 | 平均再生 |");
  lines.push("| - | -: | -: | -: | -: | -: |");
  const channelOrdered = [...channelsAnalyzed].sort((a, b) => {
    const aTotal = (byChannel.get(a.channelId) ?? []).reduce((s, v) => s + v.viewCount, 0);
    const bTotal = (byChannel.get(b.channelId) ?? []).reduce((s, v) => s + v.viewCount, 0);
    return bTotal - aTotal;
  });
  for (const c of channelOrdered) lines.push(channelLine(c, byChannel.get(c.channelId) ?? []));
  lines.push("");

  // ▼ 各チャンネルのTop 5
  lines.push("## 🔍 チャンネル別 Top 5");
  lines.push("");
  for (const c of channelOrdered) {
    const list = (byChannel.get(c.channelId) ?? []).slice().sort((a, b) => b.viewCount - a.viewCount).slice(0, 5);
    if (list.length === 0) continue;
    lines.push(`### ${c.title}`);
    lines.push("");
    lines.push(`- 登録者: ${num(c.subscriberCount)} / 動画数: ${num(c.videoCount)}`);
    lines.push(`- [チャンネルページ](https://www.youtube.com/channel/${c.channelId})`);
    lines.push("");
    lines.push("| # | タイトル | 再生数 | /day | 尺 | 投稿日 |");
    lines.push("| - | - | -: | -: | -: | - |");
    list.forEach((v, i) => {
      lines.push(`| ${i + 1} | [${esc(truncate(v.title, 70))}](${v.url}) | ${num(v.viewCount)} | ${num(v.viewsPerDay)} | ${v.durationSec}s | ${toYMD(v.publishedAt)} |`);
    });
    lines.push("");
  }

  // ▼ トピック抽出（タイトルから頻出名詞っぽい語を簡易抽出）
  const topicCounts = extractTopics(shorts.slice(0, 50));
  if (topicCounts.length > 0) {
    lines.push("## 🧭 頻出トピック（全体Top50のタイトルから）");
    lines.push("");
    lines.push("| 語 | 出現数 | 合計再生 |");
    lines.push("| - | -: | -: |");
    for (const t of topicCounts.slice(0, 30)) {
      lines.push(`| ${esc(t.term)} | ${t.count} | ${num(t.totalViews)} |`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`_生成: ${result.generatedAt} / APIクォータ消費: 約${result.quotaEstimate} units_`);
  return lines.join("\n") + "\n";
}

/**
 * タイトル中の頻出語を抽出する簡易ヒューリスティック。
 * 日本語は 2-6 文字の漢字クラスタを、英数は 3文字以上の単語を対象。
 * ストップワード / 記号 / 数字単独は除外。
 */
function extractTopics(shorts: ShortVideo[]): { term: string; count: number; totalViews: number }[] {
  const STOP = new Set([
    "歴史", "日本", "世界", "shorts", "short", "ショート", "紹介", "解説", "雑学", "知識",
    "について", "とは", "なぜ", "すごい", "やばい", "本当", "ヤバい", "意外", "驚愕",
  ]);
  const bag = new Map<string, { count: number; totalViews: number }>();
  for (const s of shorts) {
    const title = s.title;
    const tokens = new Set<string>();
    // 漢字クラスタ
    for (const m of title.matchAll(/[\u4E00-\u9FFF]{2,6}/g)) tokens.add(m[0]);
    // カタカナ語（3文字以上）
    for (const m of title.matchAll(/[\u30A0-\u30FF]{3,}/g)) tokens.add(m[0]);
    // 英数
    for (const m of title.matchAll(/[A-Za-z]{3,}/g)) tokens.add(m[0].toLowerCase());
    for (const t of tokens) {
      if (STOP.has(t) || STOP.has(t.toLowerCase())) continue;
      const prev = bag.get(t) ?? { count: 0, totalViews: 0 };
      prev.count += 1;
      prev.totalViews += s.viewCount;
      bag.set(t, prev);
    }
  }
  return [...bag.entries()]
    .map(([term, v]) => ({ term, ...v }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count || b.totalViews - a.totalViews);
}
