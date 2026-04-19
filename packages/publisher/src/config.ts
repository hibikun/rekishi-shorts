import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// env のチェックを遅延評価して `--help` などで即時失敗しないようにする
export const config = {
  youtube: {
    get clientId(): string { return requireEnv("YOUTUBE_CLIENT_ID"); },
    get clientSecret(): string { return requireEnv("YOUTUBE_CLIENT_SECRET"); },
    get refreshToken(): string { return requireEnv("YOUTUBE_REFRESH_TOKEN"); },
    get channelId(): string | undefined { return optionalEnv("YOUTUBE_CHANNEL_ID"); },
    redirectUri: process.env.YOUTUBE_REDIRECT_URI ?? "http://localhost:53682/oauth2callback",
    uploadScope: "https://www.googleapis.com/auth/youtube.upload",
  },
  gemini: {
    get apiKey(): string { return requireEnv("GEMINI_API_KEY"); },
    metadataModel: process.env.GEMINI_METADATA_MODEL ?? "gemini-3.1-flash-lite-preview",
  },
  paths: {
    repoRoot: REPO_ROOT,
    dataRoot: path.resolve(REPO_ROOT, "data"),
  },
};

export function dataPath(...segments: string[]): string {
  return path.join(config.paths.dataRoot, ...segments);
}
