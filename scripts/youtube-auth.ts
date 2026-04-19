#!/usr/bin/env node
/**
 * YouTube Data API v3 の refresh_token を取得するワンショットスクリプト。
 *
 * 前提:
 *   - .env.local に YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET を記入済み
 *   - Google Cloud Console で OAuth 2.0 クライアント (Desktop app) を作成済み
 *   - 手順は docs/phases/youtube-setup.md を参照
 *
 * 実行:
 *   pnpm --filter @rekishi/publisher exec tsx ../../scripts/youtube-auth.ts
 *   （またはルートから npx tsx scripts/youtube-auth.ts）
 */
import dotenv from "dotenv";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import open from "open";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env.local") });

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI ?? "http://localhost:53682/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(chalk.red("❌ YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET が .env.local に未設定です。"));
  console.error("   docs/phases/youtube-setup.md を参照して OAuth クライアントを作成してください。");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [SCOPE],
});

const port = Number(new URL(REDIRECT_URI).port || 53682);

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end(`OAuth error: ${error}`);
    console.error(chalk.red(`❌ OAuth error: ${error}`));
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("missing code");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      "<html><body><h1>認可完了</h1><p>このタブは閉じて構いません。ターミナルに戻ってください。</p></body></html>",
    );

    if (!tokens.refresh_token) {
      console.error(chalk.yellow("\n⚠ refresh_token が発行されませんでした。"));
      console.error("   Google アカウント側にアプリ同意が既に残っている可能性があります。");
      console.error("   https://myaccount.google.com/permissions で該当アプリを削除してから再実行してください。");
    } else {
      console.log(chalk.green("\n✅ refresh_token を取得しました。\n"));
      console.log(chalk.bold("以下の行を .env.local に追記してください:\n"));
      console.log(chalk.cyan(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`));
      console.log("");
    }
  } catch (e) {
    console.error(chalk.red("❌ token 交換失敗:"), e);
    res.writeHead(500).end("token exchange failed");
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 200);
  }
});

server.listen(port, async () => {
  console.log(chalk.bold(`\n🔐 YouTube OAuth 認可を開始します (port ${port})\n`));
  console.log("ブラウザが開かない場合は以下のURLを手動で開いてください:\n");
  console.log(chalk.cyan(authUrl));
  console.log("");
  try {
    await open(authUrl);
  } catch {
    // open が失敗しても手動URLで継続できるので握りつぶす
  }
});
