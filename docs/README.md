# rekishi-shorts ドキュメント

受験生向け歴史ショート動画の自動生成サービス。最終的にはSaaSとして提供する。

## ドキュメント構成

| ファイル | 内容 |
|---------|------|
| [tech-stack.md](./tech-stack.md) | 採用技術と選定理由、コスト試算 |
| [architecture.md](./architecture.md) | システム全体アーキテクチャ（Phase別） |
| [phases/phase-0.md](./phases/phase-0.md) | **Phase 0: CLI PoC**（2-3日） |
| [phases/phase-1.md](./phases/phase-1.md) | **Phase 1: 個人用 Web App**（1-2週間） |
| [phases/phase-2.md](./phases/phase-2.md) | **Phase 2: YouTube自動投稿＋編集UI**（1-2週間） |
| [phases/phase-3.md](./phases/phase-3.md) | **Phase 3: SaaS 化（マルチテナント＋課金）**（2-4週間） |

## プロダクト概要

- **Who**: 大学受験生（共通テスト〜二次対策、日本史・世界史）
- **What**: 60秒の歴史解説ショート動画
- **Why differentiated**: 「教科書用語統一」「受験頻出度A限定」「年号mnemonic必須」といった受験特化の編集方針
- **Where to publish**: YouTube Shorts（初期）、後に TikTok / Instagram Reels 展開

## Phase 進化のロードマップ

```
Phase 0  CLI PoC             自分だけが使う。生成できることを証明。
   ↓
Phase 1  個人用 Web App       ブラウザから使える。ジョブ管理・履歴・DL。
   ↓
Phase 2  YouTube自動投稿      台本/画像の編集UI、予約投稿、分析。
   ↓
Phase 3  SaaS                他ユーザー向けに有料提供。Stripe課金、クォータ。
```

各 Phase は独立して動くように設計する。Phase 0 で完結しても事業的に意味がある（自分が投稿できるため）。
