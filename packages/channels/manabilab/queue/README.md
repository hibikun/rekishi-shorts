# manabilab 台本キュー

`auto-draft` が出力し、人間がレビューしてから `auto-publish` が消費する台本ファイル置き場。

## ライフサイクル

```
pool [ ]
  │  pnpm auto-draft
  ▼
queue/{slug}.md  status: review-needed   ← LLM が research + draft 出力直後
  │  人間が narration / title / keyTerms 等を編集
  │  status: ready に書き換え
  ▼
queue/{slug}.md  status: ready
  │  pnpm auto-publish
  ▼
queue/{slug}.md  status: in-progress
  │  build → render → meta → post
  ▼
queue/{slug}.md  status: done + publishedUrl
pool [✅]
```

## ファイル形式

frontmatter（フラット文字列のみ）+ `## section` 本文。

```markdown
---
status: ready
slug: murasaki-vs-sei-shonagon
jobId: a1b2c3d4
poolTitle: 紫式部と清少納言は同じ宮中で同僚だったが、極度に仲が悪かった
poolLineNumber: 27
era: 古代・奈良・平安
pattern: C
videoTitleTop: 紫式部と
videoTitleBottom: 清少納言の不仲
mnemonic:
estimatedDurationSec: 42
publishedUrl:
publishedAt:
privacy:
---

## narration
（175〜225字の本文。これが TTS に流れる）

## hook
narration の冒頭1文（zod 必須だが render では未使用）

## body
（任意。空なら narration で代替）

## closing
narration の末尾1文（zod 必須だが render では未使用）

## keyTerms
- 紫式部
- 清少納言
- 一条天皇

## readings
- 清少納言: せいしょうなごん

## research
（auto-draft が research.md 全文を埋め込み。レビュー時の判断材料）
```

## 編集してよいフィールド

| 領域 | 内容 | render で使われる？ |
|---|---|---|
| `## narration` | TTS 本文 | ✅（最重要） |
| `videoTitleTop` / `videoTitleBottom` | 動画上部の常時表示タイトル | ✅ |
| `## keyTerms` | popup 用語 | ✅（scene 分割と popup） |
| `## readings` | TTS 誤読防止の読み仮名 | ✅ |
| `mnemonic` | 年号語呂合わせ | render では未使用 |
| `estimatedDurationSec` | 推定秒数 | UI 参考表示のみ |
| `## hook` / `## body` / `## closing` | 構成パートの参考表示 | ❌（zod 必須なので埋まっているだけ） |
| `## research` | リサーチ素材 | ❌（人間レビュー専用） |

## status の意味

- `review-needed` — auto-draft 出力直後。人間レビュー待ち
- `ready` — レビュー完了。`auto-publish` が次に拾う
- `in-progress` — `auto-publish` が掴んでいる最中
- `done` — 公開済み（`publishedUrl` に YouTube URL）
- `skipped` — 没にしたもの。auto-publish はスキップ

## CLI

| コマンド | 用途 |
|---|---|
| `pnpm auto-draft` | pool から 1 件 → research → draft → このディレクトリに `review-needed` で出力 |
| `pnpm auto-publish` | このディレクトリの先頭 `ready` を 1 件 → build → render → meta → post |
| `pnpm queue-list` | キュー一覧 |
| `pnpm auto-status` | ジョブ進行 + queue/pool 在庫 |

## 手書きで台本を入れる

LLM ドラフトを使わず手書きで台本を書きたいときは、このディレクトリに `{slug}.md` を直接作成し、
`status: ready` で保存する。`jobId` は空でよい（`auto-publish` が採番する）。
`poolTitle` / `poolLineNumber` を空のままにすれば、pool 連動はスキップされる。
