# YouTube 自動投稿セットアップ

Phase 0 の CLI から `videos.insert` で YouTube Shorts に自動投稿するための**1回だけ**必要な手順。

複数チャンネル（rekishi / kosei など）で投稿する場合は、**Client ID / Secret は共有**、**Refresh Token だけチャンネル別**に用意する構成を取る。

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
# 既定チャンネル (rekishi)
pnpm post auth

# 別チャンネル (例: kosei のブランドチャンネル)
pnpm --filter @rekishi/publisher exec tsx src/cli.ts auth --channel kosei
```

- ブラウザが自動で開く → 投稿したいチャンネルを持つ Google アカウントでログイン
- 「このアプリは Google で確認されていません」と出たら **「詳細」→「rekishi-shorts(安全ではないページ)に移動」**（自作アプリなのでOK）
- **チャンネル選択画面**が出たら、**投稿先のブランドチャンネル**を選ぶ（重要。ここを間違えると別チャンネルのトークンが発行される）
- 権限許可画面で「続行」
- ブラウザに「認可完了」と表示されたらタブを閉じる
- ターミナルにチャンネルに応じた env 名で `YOUTUBE_REFRESH_TOKEN=...` または `YOUTUBE_REFRESH_TOKEN_KOSEI=...` と表示される
- その値を `.env.local` に貼り付ける

### 複数チャンネル運用時の env 構成

```bash
# 共有（Google Cloud OAuth クライアント）
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...

# rekishi（既定チャンネル）
YOUTUBE_REFRESH_TOKEN=...
YOUTUBE_CHANNEL_ID=...              # 任意（stats 取得で使う）

# kosei（ブランドチャンネル、--channel kosei で読まれる）
YOUTUBE_REFRESH_TOKEN_KOSEI=...
YOUTUBE_CHANNEL_ID_KOSEI=...        # 任意
```

各チャンネル分の refresh_token を、上記のように `_${CHANNEL_ID_UPPER}` サフィックス付きで並べればそのまま使える。

## 4. 動作確認

既存の job を使って投稿まで通す:

```bash
# rekishi の場合
pnpm post meta <jobId>
pnpm post youtube <jobId> --privacy unlisted    # まず限定公開で Studio 確認
pnpm post youtube <jobId>                       # OK なら public 本番投稿

# kosei の場合（--channel kosei を付ける）
pnpm --filter @rekishi/publisher exec tsx src/cli.ts meta --channel kosei <jobId>
pnpm --filter @rekishi/publisher exec tsx src/cli.ts youtube --channel kosei <jobId> --privacy unlisted
pnpm --filter @rekishi/publisher exec tsx src/cli.ts youtube --channel kosei <jobId>
```

meta-draft は `data/<channel>/scripts/<jobId>/meta-draft.md` に出るので、必要に応じて編集してから上げる。

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
- **別チャンネルに上がってしまった**: OAuth でブランドチャンネルではなく個人チャンネルを選んでしまった可能性。`https://myaccount.google.com/permissions` からアプリ認可を解除し、`pnpm post auth --channel <id>` を再実行して、**チャンネル選択画面で正しいブランドチャンネルを選ぶ**。

## ブランドチャンネル（同一 Gmail で複数チャンネル運用）

1. YouTube → 右上のアバター → **アカウントを切り替える → チャンネルを追加する**（Studio の「設定 > チャンネル > 詳細設定」経由でも可）
2. ブランドチャンネル名・アイコンを設定（kosei なら「古生物ショート」等）
3. この状態で `pnpm post auth --channel kosei` を実行すると、OAuth 同意後に**チャンネル選択画面**が出るので、ここで作ったブランドチャンネルを選ぶ
4. ターミナルに `YOUTUBE_REFRESH_TOKEN_KOSEI=...` が出るので `.env.local` に貼り付け

既に別チャンネルで同意済みの場合は `https://myaccount.google.com/permissions` からアプリ認可を削除してから再実行する必要がある。

## セキュリティ

`YOUTUBE_CLIENT_SECRET` と `YOUTUBE_REFRESH_TOKEN` は**絶対に git に含めない**（`.env.local` は `.gitignore` 済み）。もし流出したら:

1. https://myaccount.google.com/permissions でアプリを削除
2. Google Cloud Console で OAuth クライアントを delete/regenerate
3. 手順1〜3 をやり直す
