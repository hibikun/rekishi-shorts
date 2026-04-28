import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { channelDocsDir } from "@rekishi/shared/channel";
import { createAuthClient } from "./auth.js";

export interface ChannelBrandingUpdate {
  description: string;
  /** スペース区切り。マルチワードフレーズはダブルクォートで囲む */
  keywords: string;
}

/**
 * packages/channels/<channel>/docs/youtube-channel.md から
 * `## description` と `## keywords` を抽出する。
 * 簡易マークダウンパーサ。最初に出てきた該当セクションを採用。
 */
export async function loadChannelBrandingFromMd(channel: string): Promise<ChannelBrandingUpdate> {
  const filepath = path.join(channelDocsDir(channel), "youtube-channel.md");
  const md = await fs.readFile(filepath, "utf-8");

  const description = extractSection(md, "description");
  const keywordsLine = extractSection(md, "keywords");

  if (!description) {
    throw new Error(
      `youtube-channel.md に "## description" セクションが見つかりません: ${filepath}`,
    );
  }
  if (!keywordsLine) {
    throw new Error(
      `youtube-channel.md に "## keywords" セクションが見つかりません: ${filepath}`,
    );
  }

  // keywords は md 上カンマ or スペース区切りのどちらでもOK。最終的に
  // YouTube API には スペース区切り (multi-word はダブルクォート) で送る。
  const tokens = keywordsLine
    .split(/[、,\s]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const keywords = tokens
    .map((t) => (/\s/.test(t) ? `"${t}"` : t))
    .join(" ");

  return { description: description.trim(), keywords };
}

/** "## <heading>" の次から、次の "## " or "---" が出るまでを返す */
function extractSection(md: string, heading: string): string | null {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const m = re.exec(md);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const endMatch = rest.match(/^(##\s|---\s*$)/m);
  return endMatch ? rest.slice(0, endMatch.index).trim() : rest.trim();
}

interface YoutubeApi {
  channels: {
    list(args: unknown): Promise<{ data: { items?: Array<{ id?: string; snippet?: { title?: string } }> } }>;
    update(args: unknown): Promise<{ data: { id?: string; brandingSettings?: unknown } }>;
  };
}

export async function updateChannelBranding(
  branding: ChannelBrandingUpdate,
  opts: { dryRun?: boolean } = {},
): Promise<{ channelId: string; channelTitle: string; before: ChannelBrandingUpdate; after: ChannelBrandingUpdate }> {
  const auth = createAuthClient();
  const youtube = google.youtube({ version: "v3", auth }) as unknown as YoutubeApi;

  // 1) 自分のチャンネル ID と現在の branding を取得
  const me = await youtube.channels.list({ part: ["id", "snippet", "brandingSettings"], mine: true });
  const channel = me.data.items?.[0];
  if (!channel?.id) throw new Error("authorized user に YouTube チャンネルが見つかりません");
  const channelId = channel.id;
  const channelTitle = channel.snippet?.title ?? "(unknown)";

  const beforeBranding = (channel as { brandingSettings?: { channel?: { description?: string; keywords?: string } } })
    .brandingSettings?.channel ?? {};
  const before: ChannelBrandingUpdate = {
    description: beforeBranding.description ?? "",
    keywords: beforeBranding.keywords ?? "",
  };

  if (opts.dryRun) {
    return {
      channelId,
      channelTitle,
      before,
      after: branding,
    };
  }

  // 2) channels.update で branding を上書き
  await youtube.channels.update({
    part: ["brandingSettings"],
    requestBody: {
      id: channelId,
      brandingSettings: {
        channel: {
          description: branding.description,
          keywords: branding.keywords,
        },
      },
    },
  });

  return {
    channelId,
    channelTitle,
    before,
    after: branding,
  };
}
