# Phase 1: 個人用 Web App

**期間目安**: 1-2週間
**スコープ**: ブラウザから自分だけが使える Web App。CLI を Web 化。
**前提**: Phase 0 完了（pipeline と renderer が関数として動く）

## ゴール

自分のPC以外（スマホ・別マシン含む）からもブラウザで動画生成を発注し、ジョブ進捗を確認し、完成した mp4 をダウンロードできる。

## 完了の定義（DoD）

- [ ] Supabase Auth で自分のみログイン可能（RLS で他人ブロック）
- [ ] Next.js dashboard: トピック入力フォーム → 生成ジョブ投入
- [ ] ジョブ一覧画面でステータス・進捗表示（polling）
- [ ] 完了したジョブから mp4 プレビュー + ダウンロード
- [ ] 中間成果物（台本・画像・音声）も閲覧可能
- [ ] Fly.io worker で非同期処理が動く（ローカルCLI不要）
- [ ] 失敗時に再試行ボタン

## 新規実装タスク

### Step 1. Supabase セットアップ（0.5日）
- プロジェクト作成、.env 設定
- DBマイグレーション:
  - `users`, `projects`, `jobs`, `assets` テーブル
  - RLS ポリシー（`auth.uid() = user_id` 基本）
- Storage bucket 作成: `videos`, `audio`, `images`

### Step 2. web パッケージ（3-4日）
- `packages/web/` を `kirinuki-automate/packages/web` からコピーベース
- Next.js 16 App Router
- Supabase Auth（Email OTP だけで十分）
- ルーティング:
  - `/` - ダッシュボード（最近のジョブ一覧）
  - `/generate` - 新規生成フォーム
  - `/jobs/[id]` - ジョブ詳細
  - `/login` - サインイン
- デザインシステムは `DESIGN.md` に沿う（Noto Sans JP + Outfit）

### Step 3. worker パッケージ（2-3日）
- `packages/worker/` を新規作成（`kirinuki-automate/packages/worker` をベース）
- Fly.io app 作成: `rekishi-shorts-worker`
- Dockerfile は `kirinuki-automate` 流用（chromium + ffmpeg + CJK fonts + Python3）
- ジョブ polling ループ:
  1. Supabase で `status='pending'` の jobs を1件fetch
  2. `status='processing'` に更新
  3. `pipeline.generate(topic)` → `renderer.renderHistoryShort(plan)`
  4. 中間成果物を Supabase Storage にアップロード
  5. `status='completed'` + `video_url` 書き込み
- エラー時: `status='failed'` + `error` 書き込み、リトライはユーザー操作で

### Step 4. pipeline の Storage 対応改修（1日）
- `data/` ローカル保存 → Supabase Storage に差し替え
- ただし Phase 0 の CLI も動くように、`StorageAdapter` interface で抽象化:
  - `LocalStorageAdapter`（Phase 0 互換）
  - `SupabaseStorageAdapter`（Phase 1）

### Step 5. 進捗 streaming / polling（0.5日）
- Supabase realtime で `jobs` テーブル subscribe
- または 3秒 polling で十分（シンプル）

### Step 6. デプロイ（0.5日）
- Web: Vercel（`kirinuki-automate` 流用パターン）
- Worker: `flyctl deploy`
- Supabase: マネージド

## アーキテクチャ変更

```diff
  packages/
    shared/
    pipeline/          # CLI 呼び出しも保持（後方互換）
+   web/              # Next.js 16 App Router
+   worker/           # Fly.io polling worker
    renderer/
```

## データモデル

```sql
-- Supabase Auth と1:1
create table users (
  id uuid primary key references auth.users(id),
  email text unique,
  created_at timestamptz default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  status text not null check (status in ('pending','processing','completed','failed')),
  topic jsonb not null,             -- Topic schema
  script jsonb,                      -- Script schema
  render_plan jsonb,                 -- RenderPlan schema
  video_url text,                    -- Supabase Storage signed URL
  error text,
  cost_jpy numeric,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now()
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  kind text check (kind in ('audio','image','caption','script')),
  url text,
  license text,
  attribution text,
  created_at timestamptz default now()
);

-- RLS
alter table jobs enable row level security;
create policy "own jobs" on jobs
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

## リスクと対策

| リスク | 対策 |
|--------|------|
| Fly.io worker が常時起動でコスト膨らむ | `auto_stop_machines=true` + polling 間隔長め（30秒） |
| 長時間ジョブの timeout | Fly.io は無制限。ただしNextのAPI routeは10分上限なので、ジョブは worker がやる（Web は insert だけ） |
| Storage コスト | 動画は保持期間30日、以降は delete する migration を Supabase Scheduled Functions で |
| APIキー漏洩 | `.env.local` gitignore、Fly secrets, Vercel env で管理 |

## Phase 1 → 2 への布石

- `jobs` テーブルに `youtube_upload_id` と `scheduled_publish_at` を最初から入れておく（Phase 2で使う）
- 編集UI を見越して `script.narration` と `render_plan.scenes[].imageQuery` は job 後でも UPDATE 可能にしておく
