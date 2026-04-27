# rekishi 完全自動投稿パイプライン (`auto` コマンド)

rekishi チャンネルの動画制作を **Mac 常時 ON × Claude Code の `/schedule` から朝 7:00 / 夕 19:00 に呼び出され、トピック選定〜YouTube Shorts 投稿までを 1 コマンドで完走する** 仕組み。完全手放し運用 (`unattended`) に加え、自分が確認しながら回したいときの `review` モードも同居。

## 設計方針（確定）

| 項目 | 決定 |
|---|---|
| `/schedule` の役割 | 薄いトリガー（Claude は判断しない、シェル実行のみ） |
| トピック選定 | pool 先頭の未着手 `[ ]` を 1 件 pop（AI 判断なし） |
| 投稿先 | YouTube Shorts のみ、即時公開 (`privacy: public`) |
| 頻度 | 1 日 2 本（朝・夕で別ジョブ） |
| 通知 | なし（state.json + ログ） |
| 失敗 | state に残して放置、自動 resume なし |
| ファイル構成 | `packages/pipeline/src/auto-rekishi-*.ts`（フラット） |
| 正の topic pool | `packages/channels/topic-ideas-pool.md` の「## 🇯🇵 日本史」セクションのみ |
| `⚠裏取り要` | スキップ（ファクト品質保険） |

`packages/channels/rekishi/docs/topic-ideas.md` は手動キューとして自動化対象外。

## CLI

| サブコマンド | 用途 | exit code |
|---|---|---|
| `pnpm auto` (= `auto run`) | pool pop → 全ステップ実行 → done | 0 / 1=失敗 / 2=設定不正 / 3=pool 枯渇 |
| `pnpm auto-resume <jobId>` | 失敗・保留ジョブの続きから再開 | 同上 |
| `pnpm auto-status` | 進行中・失敗ジョブと pool 残数 | 0 |
| `pnpm auto-list` | 利用可能トピックを上から N 件 | 0 |
| `pnpm auto -- pick-topic` | 1 件 pop & jobId 確保のみ（debug） | 0 / 3 |
| `pnpm auto -- unlock-pool <jobId>` | pool `[~]` を `[ ]` に戻す（救済） | 0 / 1 |

共通オプション:
- `--mode unattended | review`（既定 `unattended`）
- `--from <step>` / `--to <step>` (`pick-topic | research | draft | build | render | meta | post`)
- `--dry-run` (post を skip、pool は `[~]` 止め)
- `--no-allow-image-generation` (Wikimedia のみ)

## ステップ一覧と冪等性

| step | 実装 | 出力 | スキップ条件 |
|---|---|---|---|
| `pick-topic` | `pickNextAvailable` → `shortId()` で jobId → pool `[~]` マーク → state 種を書く | `auto-state.json` | resume 時に state.json があればスキップ |
| `research` | `runResearchStage` を直接 import | `research.md`, `research-sources.json` | `research.md` 存在 |
| `draft` | `runDraftStage` を直接 import | `script.json`, `draft.md` | `script.json` 存在 |
| `build` | `runBuildStage` を直接 import | `scene-plan.json`, `narration.wav`, `words.json`, `images.json`, `render-plan.json`, `cost.json` | `render-plan.json` 存在 |
| `render` | `renderHistoryShort` を `@rekishi/renderer` から動的 import | `data/rekishi/videos/{title}-{jobId}.mp4` | mp4 存在 |
| `meta` | `pnpm --filter @rekishi/publisher` の `meta` を spawn | `meta.json`, `meta-draft.md` | `meta.json` 存在 |
| `post` | `pnpm --filter @rekishi/publisher` の `youtube --privacy public` を spawn | `upload.json`, `data/rekishi/uploads/log.jsonl` 追記 | `hasBeenUploaded(jobId)` |

post 失敗時は pool を `[~]` のまま放置（自動 resume なし運用なので、人が `auto resume` か `auto unlock-pool` を選ぶ）。

## state.json

`data/rekishi/scripts/<jobId>/auto-state.json`

主要フィールド:
- `jobId`, `channel: "rekishi"`, `mode`
- `topic`: title / era / subject / target / format
- `pool`: 採択した行の `lineNumber` と `rawLine`（resume 時の照合用）
- `currentStep`, `status`, `error?`
- `startedAt`, `lastUpdatedAt`, `finishedAt?`
- `artifacts`: 各ステップ生成物のパス
- `options`: dryRun / allowImageGeneration

zod スキーマは `packages/pipeline/src/auto-rekishi-state.ts` の `AutoStateSchema`。書き込みは temp → rename で原子的。

## topic-pool パーサー

正規表現:
```
/^- \[(?<status>[ ~✅])\] \*\*(?<title>[^*]+)\*\*(?:\s+\[(?<pattern>[A-Z])\])?\s*(?:—|―)\s*(?<rest>.+)$/
```

セクションスコープ:
- `## 🇯🇵 日本史` → `region = "japan"` のみ採択
- `## 🌍 世界史` → 別チャンネル候補のため除外
- `### XXX (n)` → `era` を `XXX` として記録

採択フィルタ: `status === " "` ＋ `region === "japan"` ＋ `⚠裏取り要` を含まない ＋ `title.length > 0`。上から最初に通った行を返す。

書き戻し:
- `markInProgress`: `[ ]` → `[~] ... — jobId \`xxx\` startedAt <iso>`
- `markDone`: `[~]` → `[✅] ... — jobId \`xxx\` (rekishi / public) — <url>`
- `unlock`: `[~]` → `[ ]`（行末メタを剥がす）

並行起動の保険として `topic-ideas-pool.md.lock` を空ファイルで簡易 advisory lock（5 秒 × 6 回リトライ）。

## /schedule 登録

起動コマンド:
```
/Users/okawa.h/Desktop/rekishi-shorts/scripts/auto-rekishi.sh
```

cron (JST):
- 朝: `0 7 * * *`
- 夕: `0 19 * * *`

**2 つ別ジョブ**として登録（朝失敗時に夕方が独立して走る、ログ分離、頻度変更が容易）。

ログ: `data/rekishi/auto-logs/YYYYMMDD-HHMMSS.log`

## 運用チェックリスト

実投稿前:
- [ ] `.env.local` に `YOUTUBE_REFRESH_TOKEN`
- [ ] `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- [ ] YouTube quota: 1 日 2 本 = 3200 units（daily 10000 内）
- [ ] `topic-ideas-pool.md` の日本史で `[ ]` ＋ `⚠裏取り要` なし行が 2 本以上
- [ ] `pmset -g sleep` でシステムスリープ無効化

慣らし運転:
1. `pnpm auto -- --dry-run` で mp4 まで生成（投稿スキップ）
2. `pnpm auto -- --mode review` で各ゲートを確認しつつ 1 本投稿
3. `/schedule` から 1 ジョブ手動発火、完走を確認
4. 朝・夕の自動運転に切替

## ファイル構成

| パス | 役割 |
|---|---|
| `packages/pipeline/src/auto-rekishi-pool.ts` | pool パーサー＋ロック書き戻し |
| `packages/pipeline/src/auto-rekishi-state.ts` | `auto-state.json` zod schema + I/O |
| `packages/pipeline/src/auto-rekishi-topic.ts` | `PoolEntry → Topic` 変換 |
| `packages/pipeline/src/auto-rekishi-runner.ts` | オーケストレータ本体 (`runAutoOnce` / `resumeAuto`) |
| `packages/pipeline/src/auto-rekishi-review.ts` | review モード対話プロンプト |
| `scripts/auto-rekishi.sh` | `/schedule` 用ラッパ |
| `packages/pipeline/src/cli.ts` | `auto` サブコマンド群を追加 (改変) |
| `package.json` | `auto*` scripts を追加 (改変) |

## リスク・注意点

- **ukiyoe との pool 競合**: ukiyoe は `packages/channels/ukiyoe/topic-pool.md` を見ており、現在 `topic-ideas-pool.md` を読んでいないため競合なし。
- **YouTube quota 連鎖失敗**: quota exceeded で連日失敗するリスク。当面は `auto status` で手動監視。
- **`⚠裏取り要` で在庫枯渇**: 月次で pool 補充ルーティーンが必要。
- **Mac スリープ・電源断**: `pmset` でスリープ抑止、launchd は復帰時に拾わないので発火逸失は受容。
- **`[~]` 放置**: 失敗ジョブの pool は `[~]` のまま。`auto status` で可視化、`auto unlock-pool <jobId>` で救済。
