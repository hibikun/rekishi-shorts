# Phase 2: YouTube自動投稿＋編集UI

**期間目安**: 1-2週間
**スコープ**: 生成動画の編集・サムネ生成・YouTube Shortsへの予約投稿を自動化
**前提**: Phase 1 完了（Web App + Worker が動く）

## ゴール

1. 生成された台本や画像を Web UI 上で編集できる（手動QA工程の高速化）
2. YouTube Shorts へのアップロードが自動化される（日次ルーティン化）
3. 週10-30本の継続投稿が苦なく回る

## 完了の定義（DoD）

- [ ] 台本テキスト・シーン画像差し替えの編集UI
- [ ] サムネイル自動生成（Nano Banana で別アスペクト）+ 差し替えUI
- [ ] YouTube Shortsに自動アップロード（title, description, tags, thumbnail, publish日時）
- [ ] スケジューラで毎日指定時刻に投稿
- [ ] 投稿履歴・再生数の基本ダッシュボード

## 新規実装タスク

### Step 1. 編集UI（3-4日）
- `/jobs/[id]/edit` - 台本・シーン編集
  - ナレーション本文の修正（保存で TTS 再実行）
  - シーン単位: imageQuery 再検索 / Wikimedia 候補から選び直し / Nano Banana 再生成
  - プレビュー: Remotion Player（`@remotion/player` を next.js に埋め込む）
- **差分再レンダー**: 変更されたシーンだけ再生成してコスト抑制

### Step 2. サムネイル生成（1日）
- `thumbnail-generator.ts` モジュール追加
- YouTube Shorts サムネは 1080×1920 または 1280×720（Shortsは縦）
- Nano Banana で「トピック名＋キャラクター風イラスト」を生成
- もしくは Remotion で `Thumbnail` composition を作成し、オーバーレイで生成
- 編集UIで差し替え可能に

### Step 3. YouTube Data API 連携（2-3日）
- Google Cloud Console で OAuth 2.0 クライアント作成
- `/settings/youtube` - アカウント連携（OAuth consent flow）
- `youtube-tokens` テーブル追加（refresh_token 管理）
- `youtube-uploader.ts` モジュール:
  - `videos.insert` API 呼び出し
  - Shorts として認識させるため title/description に `#Shorts` 付与
  - カテゴリID 27 (Education)
  - `privacyStatus: 'private' | 'public'`、`publishAt` で予約投稿

### Step 4. スケジューラ（1日）
- Supabase Scheduled Function（pg_cron）で毎時 `scheduled_publish_at <= now()` な job を発火
- または Fly.io scheduled machine（1日1回走る）
- **簡易実装**: ユーザーが投稿日時指定 → YouTube API の publishAt に渡すだけ（YouTube側が公開する）

### Step 5. 分析ダッシュボード（1日）
- `/analytics` - 投稿履歴・再生数
- YouTube Analytics API で日次再生数を pull（1日1回 cron）
- `youtube_stats` テーブル: `video_id, date, views, likes, impressions`
- チャート: 最近30日の総再生数、本別ランキング

### Step 6. ユーザー体験改善（0.5-1日）
- トピック一括入力（CSV or テキストエリアで10本分まとめて投入）
- テンプレート保存（「鎌倉時代シリーズ」など設定プリセット）
- 再生数が伸びた動画のトピック傾向表示

## データモデル追加

```sql
create table youtube_tokens (
  user_id uuid primary key references users(id),
  access_token text,
  refresh_token text,
  channel_id text,
  expires_at timestamptz
);

create table youtube_uploads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id),
  youtube_video_id text unique,
  title text,
  description text,
  tags text[],
  thumbnail_url text,
  scheduled_publish_at timestamptz,
  published_at timestamptz,
  status text check (status in ('pending','uploading','scheduled','published','failed')),
  error text
);

create table youtube_stats (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references youtube_uploads(id),
  date date,
  views integer,
  likes integer,
  impressions integer,
  unique(upload_id, date)
);

-- jobs テーブルに追加
alter table jobs add column thumbnail_url text;
alter table jobs add column published_youtube_url text;
```

## 新規 packages（なし）

全て既存 web / worker / pipeline の拡張で対応する。

## リスクと対策

| リスク | 対策 |
|--------|------|
| YouTube API のクォータ制限（10,000 unit/日） | videos.insert = 1600 unit なので 1日6本まで。複数チャンネル必要なら別プロジェクト。 |
| OAuth refresh_token の失効 | エラー時に再連携を促す UI、通知メール送信 |
| 編集後の再レンダー時間 | シーン単位のキャッシュ、差分のみ再処理 |
| YouTube Shortsのポリシー変更 | `#Shorts` タグと縦長動画の規定を monitoring |

## Phase 2 → 3 への布石

- YouTube連携は user_id 紐付けだが、マルチテナント化時も同じ構造で OK
- `jobs` の cost_jpy を正確に記録しておく（Phase 3 のクォータ計算で使う）
- LP は Phase 3 で別途書くが、Phase 2 時点で自分の投稿実績を見せられるようにスクリーンショット・再生数を記録しておく
