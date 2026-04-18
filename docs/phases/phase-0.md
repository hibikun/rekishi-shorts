# Phase 0: CLI PoC

**期間目安**: 2-3日（実装時間 10-15h）
**スコープ**: 自分のローカルマシンで 1 コマンドで歴史ショート動画を生成できる。
**使わないもの**: Web UI / 認証 / DB / クラウド。すべて local CLI で完結。

## ゴール

`pnpm generate --topic "ペリー来航"` → 60秒前後の縦長 mp4 が `data/videos/` に出力される。

## 完了の定義（DoD）

- [ ] 任意の受験トピック（日本史・世界史問わず）で 1 コマンド生成が通る
- [ ] 出力: 1080×1920 / 60秒前後 / 30fps の mp4
- [ ] 1本あたり実測コスト ¥150 以下
- [ ] 5本連続生成テストで全て完走（冪等性・再開可能性）
- [ ] 5本中3本以上を自分が「YouTube Shortsに上げてもいい」と感じる品質

## 実装タスク

### Step 1. Scaffold（0.5h）
- `~/Desktop/rekishi-shorts/` を作成
- `kirinuki-automate` から以下を**コピーして改変**:
  - `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
  - `packages/shared/` をベースに bare 化
- `pnpm install`
- `.env.local.example` 作成

### Step 2. shared パッケージ（1h）
- 依存: なし
- Zod スキーマを先に全部定義（後続パッケージの型基盤）
- 主要スキーマ:
  - `Topic`: `{ title, era, subject: "日本史"|"世界史", target: "共通テスト"|"二次" }`
  - `Script`: `{ topic, narration, hook, body, closing, mnemonic? }`
  - `Scene`: `{ index, narration, imageQuery, durationSec }`
  - `ImageAsset`: `{ scene, source: "wikimedia"|"generated", url|path, license, attribution? }`
  - `CaptionWord`: `{ text, startSec, endSec }`
  - `RenderPlan`: `{ scenes: Scene[], audioPath, captions: CaptionWord[] }`

### Step 3. pipeline 個別モジュール（4-6h、並列可）

| モジュール | 依存API | 実装ポイント |
|------|--------|------------|
| `script-generator.ts` | Gemini 3.1 Pro | プロンプトで「受験頻出度A」「400字厳守」「年号mnemonic必須」「教科書用語統一」 |
| `scene-planner.ts` | Gemini 3.1 Flash | `responseSchema` で構造化出力、10-15シーン、imageQuery（英日両方） |
| `wikimedia-fetcher.ts` | Commons API | `action=query&generator=search&prop=imageinfo` + license filter（CC/PD のみ） |
| `image-generator.ts` | Nano Banana 2 | Wikimedia に無いシーン限定で呼ぶ |
| `asset-resolver.ts` | - | Scene[] → ImageAsset[] の解決ロジック（Wikimedia → Nano Banana fallback） |
| `tts-generator.ts` | ElevenLabs | `eleven_multilingual_v2`、voice_id を `.env` で切替可能 |
| `asr-aligner.ts` | OpenAI Whisper | `timestamp_granularities: ["word"]` |

### Step 4. orchestrator & CLI（1h）
- 依存: Step 2 + 3
- `orchestrator.generate(topic)` が全工程を直列実行し `RenderPlan` を返す
- 各工程の中間成果物を `data/` に保存（再開可能）
- CLI: `commander` で `generate`, `script-only`, `tts-only` 等のサブコマンド

### Step 5. renderer（3-4h）
- 依存: Step 2
- `KenBurnsImage.tsx`: `interpolate(frame, [0, duration], [1, 1.15])` で slow zoom、方向ランダム
- `KaraokeCaption.tsx`: `CaptionWord[]` を受け取り現在フレームの単語を強調、下1/3配置
- `HistoryShort.tsx`: Scene配列 + audio + captions を組む
- `render.ts`: `renderHistoryShort(plan, outputPath)` を公開

### Step 6. End-to-end スモーク（1-2h）
- `pnpm generate --topic "ペリー来航"` → mp4 出力
- 確認項目:
  - [ ] ナレーションが自然
  - [ ] Wikimedia の画像が適切に選ばれている
  - [ ] 字幕の単語タイミングが音声と一致
  - [ ] 動画が縦長1080×1920で60秒前後
  - [ ] 受験用語として違和感ない

## 成果物

- `packages/pipeline/` - AI 呼び出しモジュール群 + CLI
- `packages/renderer/` - Remotion composition
- `packages/shared/` - Zod schemas
- `data/` - 生成結果（gitignore、自分のローカルのみ）
- `docs/poc-report.md` - 5本生成のクオリティレビュー

## リスクと対策

| リスク | 対策 |
|--------|------|
| ElevenLabs 日本語の固有名詞誤読 | 読み替え辞書を `prompts/furigana.ts` に用意し TTS直前に置換 |
| Wikimedia 欠番でNano Banana乱発 | シーン数上限15、Nano Banana生成は1本あたり5枚まで |
| Whisper の日本語 word timestamp 精度 | 精度悪ければ句読点単位でフォールバック |
| Remotion render時間が長い | ローカル render 優先、Fly.io 移行は Phase 1 |

## Phase 0 → 1 の移行ポイント

- pipeline は **関数呼び出しで完結するライブラリ** として設計する（CLIはその薄いラッパー）
- → Phase 1 の Fly.io worker から同じ関数を呼べば良いだけになる
- 中間成果物の保存先を `data/` → Supabase Storage に差し替えるだけで Phase 1 が動く構造にする
