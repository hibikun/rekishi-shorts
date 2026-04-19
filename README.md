# rekishi-shorts

受験生向け歴史ショート動画の自動生成サービス。

## 現在の Phase

**Phase 0: CLI PoC**（ローカル完結）

## セットアップ

```bash
pnpm install
cp .env.local.example .env.local
# .env.local に APIキーを記入
```

## 使い方（Phase 0）

```bash
# 動画生成（台本→音声→字幕→レンダリングまで一気通貫）
pnpm generate --topic "ペリー来航"

# 個別工程のみ実行
pnpm --filter @rekishi/pipeline script-only --topic "ペリー来航"
pnpm --filter @rekishi/pipeline tts-only --script data/scripts/<id>.json

# Remotion Studio でプレビュー
pnpm studio
```

出力は `data/videos/` に格納される。

## YouTube Shorts 自動投稿

```bash
# 初回だけ: docs/phases/youtube-setup.md に沿って OAuth を設定

# メタデータを LLM で生成 → 人間レビュー
pnpm post meta <jobId>

# data/scripts/<jobId>/meta-draft.md を必要に応じて編集

# 投稿（デフォルト public）
pnpm post youtube <jobId>
pnpm post youtube <jobId> --privacy private   # テスト用
pnpm post youtube <jobId> --dry-run           # 送信せずペイロード確認
```

## ドキュメント

- [docs/README.md](./docs/README.md) - 全体インデックス
- [docs/tech-stack.md](./docs/tech-stack.md) - 技術選定
- [docs/architecture.md](./docs/architecture.md) - アーキテクチャ図
- [docs/phases/phase-0.md](./docs/phases/phase-0.md) - 現在実装中の内容
