# Phase 3: SaaS 化

**期間目安**: 2-4週間
**スコープ**: 他ユーザー向けに有料サービスとして提供
**前提**: Phase 2 完了（自分の運用が回っており実績データがある）

## ゴール

受験関連サイトやコーチング運営者、独学系 YouTuber 等に、月額課金でサービス提供。MVP価格は「受験ショート動画を月30本まで生成」で月額 ¥3,000-5,000 想定。

## 完了の定義（DoD）

- [ ] マルチテナント対応（Supabase RLS + `tenant_id` 設計）
- [ ] Stripe サブスクリプション課金（3プラン: Free / Creator / Pro）
- [ ] プラン別のクォータ管理（月次本数・ElevenLabs credits）
- [ ] 公開LP（ランディングページ）
- [ ] 利用規約・プライバシーポリシー
- [ ] サポート窓口（最低限、メールフォームと FAQ）
- [ ] クローズドβで 10 ユーザー運用が回る

## 新規実装タスク

### Step 1. マルチテナント化（2-3日）
- 既存 schema の `user_id` はそのまま使える（Phase 1 から想定済み）
- RLS ポリシー強化（他ユーザーのデータ一切見えない）
- ストレージパスを `{user_id}/jobs/{job_id}/...` 形式に統一
- 管理者アカウント（自分）が全テナント見られる admin policy 追加

### Step 2. Stripe サブスクリプション（3-4日）
- `subscriptions` テーブル追加
- Stripe Checkout Session でプラン購入
- Webhook endpoint: `POST /api/stripe/webhook`
  - `invoice.paid` → サブスク延長
  - `customer.subscription.deleted` → plan 降格
  - `invoice.payment_failed` → 通知
- `middleware.ts` でプラン未加入者を /pricing にリダイレクト

### Step 3. プラン設計とクォータ（2日）
- `plans` テーブル（seed data）:
  - Free: 月3本、ElevenLabs 使用不可（Gemini TTS fallback）
  - Creator: 月30本、ElevenLabs OK、¥3,000/月
  - Pro: 月100本、優先処理、¥9,800/月
- `quota.ts` モジュール: `checkQuota(userId, action)` → OK/NG
- 月初に `users.monthly_video_count` をリセットする Supabase cron

### Step 4. 公開LP（3-4日）
- `/` （ログイン済みは `/dashboard` リダイレクト、未ログインはLP表示）
- セクション:
  - Hero: 「受験歴史のショートを毎日自動生成」
  - 実績: 自分の YouTube チャンネル埋め込み（Phase 2で運用していれば強い）
  - サンプル動画（Remotion Player で埋め込み）
  - 料金プラン
  - FAQ
  - CTA
- デザインは `DESIGN.md` の Indigo + Orange ベース（`kirinuki-automate` と色分け）

### Step 5. 利用規約・プライバシー（1日）
- 生成コンテンツの著作権帰属明記（ユーザー側）
- 歴史的事実の正確性は保証しない旨（AI生成）
- Wikimedia ライセンスの継承義務（CC-BY-SA は attribution 必須）を自動で description に入れる機能
- 特商法表記

### Step 6. サポート窓口とモニタリング（1-2日）
- `/support` - 問い合わせフォーム（Slack webhook に通知）
- FAQ ページ
- エラートラッキング: Sentry 導入
- 使用量ダッシュボード: `admin/dashboard`（自分専用）
  - 今月の生成本数、ユーザー数、解約率、エラー率
- **コスト監視**: 月次原価 vs 売上（Plan別）

### Step 7. クローズドβ運用（1週間）
- 知り合いの受験系コーチ・教育系YouTuber 5-10人に声かけ
- 無料招待 → 1ヶ月後にフィードバック収集
- バグ修正・UI改善
- 正式ローンチへ

## データモデル追加

```sql
create table plans (
  id text primary key,  -- 'free', 'creator', 'pro'
  name text,
  monthly_video_quota integer,
  tts_provider text,    -- 'elevenlabs' | 'gemini'
  price_jpy integer,
  stripe_price_id text,
  features jsonb
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) unique,
  plan_id text references plans(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text check (status in ('active','past_due','canceled','incomplete')),
  current_period_end timestamptz,
  created_at timestamptz default now()
);

-- users に追加
alter table users add column plan_id text references plans(id) default 'free';
alter table users add column monthly_video_count integer default 0;
alter table users add column month_reset_at timestamptz default date_trunc('month', now()) + interval '1 month';
```

## アーキテクチャ変更

```diff
  packages/
    shared/
    pipeline/
    web/
    worker/
    renderer/
+   billing/         # Stripe 呼び出し + quota 判定ロジック
+   support/         # （必要なら）問い合わせ通知
```

## リスクと対策

| リスク | 対策 |
|--------|------|
| ElevenLabs 利用規約（生成音声の再販） | Scale プラン以上必須。Free プランは Gemini TTS fallback で回避 |
| 事実誤認による炎上（受験生を誤誘導） | 「本サービスは学習補助であり正確性を保証しない」明記、人間レビュー推奨を UX で訴求 |
| チャージバック・コスト逆ざや | 月初クォータ枠を厳格に、超過は再課金制 |
| Supabase や Fly.io の単価上昇 | 主要コストは ElevenLabs と Nano Banana。Gemini/Fly への依存度は小さいので乗換余地あり |
| 競合参入（他のショート動画AI） | 受験特化・教科書用語辞書・頻出度DB で参入障壁 |

## 事業的マイルストーン

| マイルストーン | 到達定義 |
|--------------|---------|
| クローズドβローンチ | β招待 10 人が動画を1本以上生成 |
| 公開ローンチ | LP公開 + Stripe有効化 + 最初の有料課金 1件 |
| MRR ¥30,000 | Creator 10人 |
| MRR ¥100,000 | Creator 30人 or Pro 10人 |
| 撤退条件 | 3ヶ月連続で月次アクティブ < 5 かつ新規流入 = 0 |

## Phase 3 の先（将来）

- 世界史以外の科目展開（古典・地理・理科）
- TikTok / Instagram Reels 同時投稿
- AI講師キャラクターの音声クローン（ElevenLabs VoiceLab）
- 解説 PDF や問題集との連携
- B2B（塾・予備校向けライセンス）
