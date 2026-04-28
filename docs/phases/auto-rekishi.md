# rekishi 自動投稿パイプライン (二相分割版 / `auto draft` + `auto publish`)

ショート動画の品質は **台本でほぼ決まる** ため、自動投稿を 2 相に分け、
中間の台本キューで人間レビューを挟む構成にしている。

```
pool [ ]   topic-ideas-pool.md（着想ストック）
  │
  │ pnpm auto-draft（手動 or 低頻度 cron）
  ▼
research → draft
  │
  ▼
queue/{slug}.md  status: review-needed     ← auto-draft 出力直後
  │
  │ 👤 narration / title / keyTerms を編集して
  │    status: ready に書き換える
  ▼
queue/{slug}.md  status: ready
  │
  │ pnpm auto-publish（cron 朝7 / 夕19）
  ▼
build → render → meta → post
  │
  ▼
queue/{slug}.md  status: done + URL
pool [✅]
```

## 設計方針（確定）

| 項目 | 決定 |
|---|---|
| 自動投稿の構造 | **2 相分割**（draft / publish） |
| `/schedule` の役割 | publish 相だけを cron で回す（draft は手動が既定） |
| トピック選定 | pool 先頭の未着手 `[ ]` を 1 件 pop（AI 判断なし） |
| 台本生成 | research + draft で LLM が下書き、queue ファイルに出力して人間レビュー |
| 投稿先 | YouTube Shorts のみ、即時公開 (`privacy: public`) |
| 頻度 | publish: 1 日 2 本 / draft: 必要時に手動実行 |
| 通知 | なし（state.json + ログ） |
| 失敗 | state に残して放置、自動 resume なし |
| ファイル構成 | `packages/pipeline/src/auto-rekishi-*.ts`（フラット） |
| pool 対象 | `packages/channels/topic-ideas-pool.md` 「## 🇯🇵 日本史」セクション |
| queue 場所 | `packages/channels/rekishi/queue/{slug}.md` |
| `⚠裏取り要` | スキップ（draft 段階で除外） |
| slug | Gemini Flash で英語 kebab-case を生成、衝突時は `-2` suffix |

## CLI

| コマンド | 用途 | exit code |
|---|---|---|
| `pnpm auto-draft` | pool pop → research → draft → queue 出力（`review-needed`） | 0 / 1=失敗 / 2=設定不正 / 3=pool 枯渇 |
| `pnpm auto-publish` | queue から `ready` を 1 件 → build → render → meta → post | 0 / 1=失敗 / 2=設定不正 / 3=queue 枯渇 |
| `pnpm auto-resume <jobId>` | 失敗・保留ジョブの続きから再開（phase 自動判定） | 同上 |
| `pnpm auto-status` | 進行中・失敗・レビュー待ちジョブ + queue / pool 在庫 | 0 |
| `pnpm queue-list` | queue ファイル一覧（status 別フィルタ可） | 0 |
| `pnpm pool-list` | pool 利用可能トピック上から N 件 | 0 |
| `pnpm auto -- queue unlock <slug>` | queue `in-progress` を `ready` に戻す | 0 / 1 |
| `pnpm auto -- pool unlock <jobId>` | pool `[~]` を `[ ]` に戻す | 0 / 1 |

共通オプション:
- `--mode unattended | review`（既定 `unattended`）
- `--from <step>` / `--to <step>`（draft: `pick-topic|research|draft`, publish: `pick-script|build|render|meta|post`）
- `--dry-run`（publish のみ。post を skip、queue は `in-progress` 止め）
- `--no-allow-image-generation`（publish のみ。Wikimedia のみ）

## ステップ一覧と冪等性

### draft 相

| step | 実装 | 出力 | スキップ条件 |
|---|---|---|---|
| `pick-topic` | `pickNextAvailable` → `shortId()` で jobId → pool `[~]` マーク → state 種を書く | `auto-state.json`（phase=draft） | resume 時に state.json があればスキップ |
| `research` | `runResearchStage` を直接 import | `research.md`, `research-sources.json` | `research.md` 存在 |
| `draft` | `runDraftStage` 実行 → slug 生成 → queue ファイル書き出し | `script.json`, `draft.md`, `queue/{slug}.md` | `script.json` 存在 + queue 存在 |

draft 完走後は `state.status = "awaiting-review"` で停止。

### publish 相

| step | 実装 | 出力 | スキップ条件 |
|---|---|---|---|
| `pick-script` | `pickNextReady` → queue を `in-progress` に → queue から `script.json` を再 materialize → state を `phase=publish` に遷移 | `script.json`（上書き） | 新規実行 or `--from pick-script` 指定時のみ |
| `build` | `runBuildStage` を直接 import | `scene-plan.json`, `narration.wav`, `words.json`, `images.json`, `render-plan.json`, `cost.json` | `render-plan.json` 存在 |
| `render` | `renderHistoryShort` を `@rekishi/renderer` から動的 import | `data/rekishi/videos/{title}-{jobId}.mp4` | mp4 存在 |
| `meta` | `pnpm --filter @rekishi/publisher` の `meta` を spawn | `meta.json`, `meta-draft.md` | `meta.json` 存在 |
| `post` | `pnpm --filter @rekishi/publisher` の `youtube --privacy public` を spawn | `upload.json`, `data/rekishi/uploads/log.jsonl` 追記 | `hasBeenUploaded(jobId)` |

post 成功時は queue ファイルを `done` に、pool 行を `[✅]` に書き戻す。
post 失敗時は queue を `in-progress` のまま放置（人が `auto-resume` か `auto queue unlock` を選ぶ）。

## state.json

`data/rekishi/scripts/<jobId>/auto-state.json`

主要フィールド:
- `jobId`, `channel: "rekishi"`, `mode`
- `phase`: `"draft" | "publish"` — どの相で動いているか
- `topic`: title / era / subject / target / format
- `pool`: 採択した行の `lineNumber` と `rawLine`（手書き queue の場合は null）
- `queue`: `{ slug, path }`（draft 完了後に埋まる）
- `currentStep`, `status` (`running | awaiting-confirmation | awaiting-review | done | failed`)
- `error?`
- `startedAt`, `lastUpdatedAt`, `finishedAt?`
- `artifacts`: 各ステップ生成物のパス
- `options`: dryRun / allowImageGeneration

zod スキーマは `packages/pipeline/src/auto-rekishi-state.ts` の `AutoStateSchema`。書き込みは temp → rename で原子的。

## queue ファイル

詳細は `packages/channels/rekishi/queue/README.md`。frontmatter (フラット文字列) + `## section` 本文。

ライフサイクル: `review-needed → ready → in-progress → done`（途中で `skipped` も可）

human が編集する主要フィールド:
- `## narration`（175〜225字、TTS 本文）
- `videoTitleTop` / `videoTitleBottom`（動画上部の常時表示）
- `## keyTerms`（popup 用語）
- `## readings`（TTS 誤読防止）
- 状態を `review-needed` → `ready` に書き換える

## /schedule 登録

起動コマンド:
```
/Users/okawa.h/Desktop/rekishi-shorts/scripts/auto-rekishi.sh
```

このスクリプトは `auto publish` を呼ぶ。cron (JST):
- 朝: `0 7 * * *`
- 夕: `0 19 * * *`

draft は当面 cron 化せず、queue 在庫が減ったら手元で `pnpm auto-draft` を回す運用。

ログ: `data/rekishi/auto-logs/YYYYMMDD-HHMMSS.log`

## 運用チェックリスト

### 投稿前（draft）
- [ ] `.env.local` に `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ELEVENLABS_*`
- [ ] `topic-ideas-pool.md` の日本史で `[ ]` ＋ `⚠裏取り要` なし行が 1 本以上
- [ ] queue/ ディレクトリが存在

### 投稿前（publish）
- [ ] `.env.local` に `YOUTUBE_REFRESH_TOKEN`
- [ ] YouTube quota: 1 日 2 本 = 3200 units（daily 10000 内）
- [ ] queue に `status: ready` の台本が 2 本以上
- [ ] `pmset -g sleep` でシステムスリープ無効化

### 慣らし運転
1. `pnpm auto-draft` を手動実行 → queue ファイルが `review-needed` で出ることを確認
2. queue ファイルを `ready` に書き換え → `pnpm auto-publish -- --dry-run` で mp4 まで生成
3. `pnpm auto-publish -- --mode review` で各ゲートを確認しつつ 1 本投稿
4. `/schedule` から 1 ジョブ手動発火、完走を確認
5. 朝・夕の自動運転に切替

## ファイル構成

| パス | 役割 |
|---|---|
| `packages/pipeline/src/auto-rekishi-pool.ts` | pool パーサー＋ロック書き戻し |
| `packages/pipeline/src/auto-rekishi-queue.ts` | queue ファイル パーサ＋ロック＋status I/O |
| `packages/pipeline/src/auto-rekishi-script-io.ts` | Script ↔ queue.md 双方向シリアライズ |
| `packages/pipeline/src/auto-rekishi-state.ts` | `auto-state.json` zod schema + I/O |
| `packages/pipeline/src/auto-rekishi-topic.ts` | `PoolEntry → Topic` 変換 |
| `packages/pipeline/src/auto-rekishi-runner.ts` | `runAutoDraft` / `runAutoPublish` / `resumeAuto` |
| `packages/pipeline/src/auto-rekishi-review.ts` | review モード対話プロンプト |
| `packages/pipeline/src/slug-generator.ts` | Gemini Flash で英語 slug 生成 |
| `packages/channels/rekishi/queue/` | queue ファイル置き場 |
| `scripts/auto-rekishi.sh` | `/schedule` 用 publish ラッパ |
| `packages/pipeline/src/cli.ts` | `auto draft` / `auto publish` / `auto queue` / `auto pool` サブコマンド |
| `package.json` | `auto-draft`, `auto-publish`, `auto-resume`, `auto-status`, `queue-list`, `pool-list` |

## リスク・注意点

- **queue 枯渇**: publish 実行時に `ready` ゼロなら exit 3。draft をこまめに回す or 手動で台本投入
- **draft の在庫過多**: queue が膨らみすぎたら `skipped` でフィルタアウト
- **YouTube quota 連鎖失敗**: quota exceeded で連日失敗するリスク。`auto-status` で手動監視
- **`⚠裏取り要` で在庫枯渇**: 月次で pool 補充ルーティーンが必要
- **Mac スリープ・電源断**: `pmset` でスリープ抑止、launchd は復帰時に拾わないので発火逸失は受容
- **`[~]` / `in-progress` 放置**: 失敗ジョブのマーカーは残る。`auto status` で可視化、`auto pool unlock <jobId>` / `auto queue unlock <slug>` で救済
- **手書き queue と pool の不整合**: 手書きで `poolTitle` 空の queue を投稿しても pool は連動しない（仕様）
