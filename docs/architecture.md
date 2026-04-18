# アーキテクチャ

## Phase 別構成図

### Phase 0: CLI PoC

```
┌─────────────────────────────────────────────────────────────┐
│ ユーザー (自分)                                                 │
│  │                                                            │
│  └──> pnpm generate --topic "ペリー来航"                       │
│         │                                                     │
│         ▼                                                     │
│   ┌──────────────────────────────────────┐                   │
│   │  pipeline (CLI)                      │                   │
│   │  ┌─────────┐  ┌─────────┐  ┌──────┐ │                   │
│   │  │ Gemini  │─▶│ Gemini  │─▶│Wiki/ │ │                   │
│   │  │ Pro     │  │ Flash   │  │ Nano │ │                   │
│   │  │(script) │  │(scenes) │  │Banana│ │                   │
│   │  └─────────┘  └─────────┘  └──────┘ │                   │
│   │       │            │            │    │                   │
│   │       ▼            ▼            ▼    │                   │
│   │  ┌─────────┐  ┌──────────┐          │                   │
│   │  │ElevenLabs│─▶│ Whisper │          │                   │
│   │  │  (TTS)  │  │ (word)  │          │                   │
│   │  └─────────┘  └──────────┘          │                   │
│   └──────────────┬───────────────────────┘                   │
│                  │                                            │
│                  ▼                                            │
│            RenderPlan (JSON)                                  │
│                  │                                            │
│                  ▼                                            │
│   ┌──────────────────────────────────────┐                   │
│   │  renderer (Remotion CLI, local)      │                   │
│   │  → data/videos/*.mp4                 │                   │
│   └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### Phase 1: 個人用 Web App

```
┌───────────────┐          ┌─────────────────┐
│ ブラウザ (自分) │─────────▶│ Next.js (Vercel)│
└───────────────┘          │  - Dashboard    │
                           │  - Auth callback│
                           └────────┬────────┘
                                    │
                           ┌────────▼────────┐
                           │ Supabase        │
                           │  - Auth         │
                           │  - Postgres     │
                           │   (jobs, users) │
                           │  - Storage      │
                           │   (mp4, assets) │
                           └────────┬────────┘
                                    │ (jobs poll)
                           ┌────────▼────────┐
                           │ Fly.io worker   │
                           │  (pipeline +    │
                           │   renderer)     │
                           └─────────────────┘
```

### Phase 2: YouTube自動投稿＋編集UI

Phase 1 構成に加えて:
- **YouTube Data API v3** 連携（worker からアップロード）
- **編集UI**（Next.js に台本・画像差替え画面追加）
- **スケジューラ**（Supabase cron or Fly.io scheduled machine）
- **サムネイル生成**（Nano Banana で別アスペクト）

### Phase 3: SaaS 化

Phase 2 構成に加えて:
- **Stripe**（subscription + webhook endpoint on Next.js）
- **マルチテナント**（`users.tenant_id`、Supabase RLS）
- **クォータ管理**（Postgres count で月次カウント）
- **LP（公開マーケティングページ）**
- **管理コンソール**（内部用）

## データモデル（Phase 1以降）

```
users              (Supabase Auth と同期)
  id, email, created_at, plan_id(FK), monthly_video_count

projects
  id, user_id, name, created_at
  (受験科目・目標大学などの設定を保持)

jobs
  id, project_id, status, topic, script_json, render_plan_json,
  video_url, error, started_at, finished_at, cost_jpy

assets                     (Phase 1: 中間成果物保存)
  id, job_id, kind (audio|image|caption), url, license, attribution

youtube_uploads            (Phase 2)
  id, job_id, youtube_video_id, scheduled_at, published_at, status

subscriptions              (Phase 3)
  user_id, stripe_customer_id, stripe_subscription_id, plan_id, status
```

## 主要シーケンス（Phase 1 以降）

### 動画生成ジョブ

```
Browser        Next.js          Supabase           Fly.io worker
   │               │                │                     │
   │─ Submit ─────▶│                │                     │
   │   topic       │─ Insert job ──▶│                     │
   │               │                │                     │
   │               │◀──── job_id ───│                     │
   │◀──── 202 ─────│                │                     │
   │               │                │◀── Poll pending ────│
   │               │                │─── job data ──────▶ │
   │               │                │                     │
   │               │                │                (generate)
   │               │                │                     │
   │               │                │◀── Update status ───│
   │               │                │    (finished)       │
   │               │                │                     │
   │─ GET status ─▶│                │                     │
   │               │── Query ──────▶│                     │
   │               │◀── job row ────│                     │
   │◀─ video_url ──│                │                     │
```
