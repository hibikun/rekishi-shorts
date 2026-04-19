# YouTube 自動投稿セットアップ

Phase 0 の CLI から `videos.insert` で YouTube Shorts に自動投稿するための**1回だけ**必要な手順。

## 1. Google Cloud Console

1. https://console.cloud.google.com/ でプロジェクトを作成（例: `rekishi-shorts`）
2. 左メニュー > **APIs & Services > Library** で `YouTube Data API v3` を有効化
3. **APIs & Services > OAuth consent screen**
   - User Type: **External**
   - App name: `rekishi-shorts` / User support email: 自分の Gmail
   - Scopes: `https://www.googleapis.com/auth/youtube.upload` のみ追加
   - Test users: 自分の Gmail（投稿先チャンネルの所有者）を追加
4. **APIs & Services > Credentials > Create Credentials > OAuth client ID**
   - Application type: **Desktop app**
   - 作成後、`Client ID` と `Client Secret` をコピー

## 2. `.env.local` に貼り付け

`.env.local` を開き以下を追記:

```
YOUTUBE_CLIENT_ID=<コピーした Client ID>
YOUTUBE_CLIENT_SECRET=<コピーした Client Secret>
# 以下は次のステップで取得
YOUTUBE_REFRESH_TOKEN=
```

## 3. refresh_token を取得

ターミナルでリポジトリルートから:

```bash
npx tsx scripts/youtube-auth.ts
```

- ブラウザが開く → Google アカウントでログイン → 同意
- 「このアプリは Google で確認されていません」と出たら **「詳細」→「安全ではないページに移動」**（自作アプリなのでOK）
- ターミナルに `YOUTUBE_REFRESH_TOKEN=...` と表示される
- その値を `.env.local` の `YOUTUBE_REFRESH_TOKEN=` の右に貼り付ける

## 4. 動作確認

既存の job を使って投稿まで通す:

```bash
# meta-draft.md を生成
pnpm post meta <jobId>

# 内容をレビュー (必要なら data/scripts/<jobId>/meta-draft.md を編集)

# まず private で送信して Studio で確認
pnpm post youtube <jobId> --privacy private

# OK なら public で本番投稿
pnpm post youtube <jobId>
```

## クォータと制限

| 項目 | 値 |
|------|------|
| `videos.insert` | 1,600 units / 回 |
| デフォルト 1日あたり | 10,000 units（= **1日6本まで**） |
| 本数増やしたい場合 | https://support.google.com/youtube/contact/yt_api_form で audit 申請 |

## よくあるエラー

- **`invalid_grant`**: refresh_token が失効。手順3を再実行してください。
- **`quotaExceeded`**: 当日のクォータ切れ。翌日リセットを待つか audit 申請。
- **`youtubeSignupRequired`**: Google アカウントに YouTube チャンネルが無い。Studio でチャンネルを作成してください。

## セキュリティ

`YOUTUBE_CLIENT_SECRET` と `YOUTUBE_REFRESH_TOKEN` は**絶対に git に含めない**（`.env.local` は `.gitignore` 済み）。もし流出したら:

1. https://myaccount.google.com/permissions でアプリを削除
2. Google Cloud Console で OAuth クライアントを delete/regenerate
3. 手順1〜3 をやり直す
