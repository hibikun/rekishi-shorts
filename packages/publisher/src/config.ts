import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CHANNEL, channelDataPath, getChannel } from "@rekishi/shared/channel";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "../../../");
dotenv.config({ path: path.join(REPO_ROOT, ".env.local") });
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set. See docs/phases/youtube-setup.md`);
  return v;
}

function optionalEnv(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

/**
 * チャンネル別 env 変数を優先して読む。
 * - rekishi (= DEFAULT_CHANNEL): `YOUTUBE_REFRESH_TOKEN` をそのまま使う（後方互換）
 * - kosei:  まず `YOUTUBE_REFRESH_TOKEN_KOSEI` を見て、無ければ `YOUTUBE_REFRESH_TOKEN` にフォールバック
 */
export function channelEnvName(base: string, channel: string = getChannel()): string {
  return channel === DEFAULT_CHANNEL ? base : `${base}_${channel.toUpperCase()}`;
}

function requireChannelEnv(base: string): string {
  const primary = channelEnvName(base);
  const v = process.env[primary];
  if (v && v.length > 0) return v;
  // fallback: default channel 名なしキー
  if (primary !== base) {
    const fallback = process.env[base];
    if (fallback && fallback.length > 0) return fallback;
  }
  throw new Error(
    `${primary} is not set (channel=${getChannel()}). See docs/phases/youtube-setup.md for brand-channel setup.`,
  );
}

function optionalChannelEnv(base: string): string | undefined {
  const primary = channelEnvName(base);
  const v = process.env[primary];
  if (v && v.length > 0) return v;
  if (primary !== base) {
    const fallback = process.env[base];
    if (fallback && fallback.length > 0) return fallback;
  }
  return undefined;
}

// env のチェックを遅延評価して `--help` などで即時失敗しないようにする。
// Client ID / Secret は Google Cloud プロジェクト単位なのでチャンネル間で共有可能。
// Refresh Token / Channel ID はチャンネル別の変数を優先して読む。
export const config = {
  youtube: {
    get clientId(): string { return requireEnv("YOUTUBE_CLIENT_ID"); },
    get clientSecret(): string { return requireEnv("YOUTUBE_CLIENT_SECRET"); },
    get refreshToken(): string { return requireChannelEnv("YOUTUBE_REFRESH_TOKEN"); },
    get channelId(): string | undefined { return optionalChannelEnv("YOUTUBE_CHANNEL_ID"); },
    redirectUri: process.env.YOUTUBE_REDIRECT_URI ?? "http://localhost:53682/oauth2callback",
    uploadScope: "https://www.googleapis.com/auth/youtube.upload",
    analyticsScope: "https://www.googleapis.com/auth/yt-analytics.readonly",
  },
  gemini: {
    get apiKey(): string { return requireEnv("GEMINI_API_KEY"); },
    metadataModel: process.env.GEMINI_METADATA_MODEL ?? "gemini-3.1-flash-lite-preview",
  },
  paths: {
    repoRoot: REPO_ROOT,
  },
};

export function dataPath(...segments: string[]): string {
  return channelDataPath(...segments);
}
