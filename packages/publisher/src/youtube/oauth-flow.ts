import http from "node:http";
import { google } from "googleapis";
import open from "open";
import chalk from "chalk";

/**
 * YouTube Data API v3 の refresh_token をインタラクティブに取得する。
 * ローカルHTTPサーバーを立ててOAuth2コールバックを受け取り、
 * token 交換して refresh_token を標準出力する。
 *
 * 前提: .env.local に YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET が記入済み。
 */
export async function runOAuthFlow(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}): Promise<void> {
  const oauth2 = new google.auth.OAuth2(opts.clientId, opts.clientSecret, opts.redirectUri);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: opts.scopes,
  });

  const port = Number(new URL(opts.redirectUri).port || 53682);

  return new Promise<void>((resolve) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/oauth2callback")) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, opts.redirectUri);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end(`OAuth error: ${error}`);
        console.error(chalk.red(`❌ OAuth error: ${error}`));
        server.close();
        resolve();
        return;
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
        resolve();
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
        // 握りつぶす（手動URLで継続できる）
      }
    });
  });
}
