# 浮世絵チャンネル (`ukiyoe`) 設計

> 浮世絵タッチのイラストを **fal.ai Seedance 1.5 Pro** で動かし、
> 「○○の1日」型ルーティーン動画として配信する第4チャンネル。
> 既存の `rekishi` / `ranking` / `kosei` には**論理的な変更を加えず**に追加する。

## 1. 背景

### 1.1 なぜ作るか

- 既存 `rekishi` は静止画の Ken Burns（pan/zoom）が中心で、滞在時間が頭打ち
- 参考動画（YouTube `dHeRcrpP_N8` 「江戸時代の継飛脚の1日ルーティーン」）のような
  **動くイラスト × ルーティーン構成**が伸びている
- AI img2video（Seedance 1.5 Pro）が品質・コスト面で実用ラインに到達したため、
  「コードベースのパペットアニメ」ではなく**最初から AI 動画生成前提**で設計する

### 1.2 PoC で確定した事実（2026-04-26）

- `packages/pipeline/src/poc-fal-video.ts` で実画像 → 5 秒クリップ生成成功
- 採用モデル：**Seedance 1.5 Pro**（720p / 9:16 / 5秒 / 音声なし / 約 \$0.13/clip）
- 1本（8 シーン）= 約 \$1.04（≒156 円）— 当初試算の 1/4

## 2. フォーマット仕様

### 2.1 動画スペック

| 項目 | 値 |
|---|---|
| 尺 | 40 秒（8 シーン × 5 秒固定） |
| 解像度 | 720 × 1280（9:16 縦動画） |
| FPS | 24（Seedance 既定） |
| 音声 | ナレーション（ElevenLabs / Gemini TTS）+ BGM。動画クリップ自体は無音 |
| 字幕 | 既存 ASR (Whisper) でタイムスタンプ取得 |

### 2.2 構成テンプレ「○○の1日」

| # | 役割 | 動勢 | 例（継飛脚） |
|---|------|------|-------------|
| 1 | フック | 動 | 街道を疾走する飛脚 |
| 2 | 朝の出立 | 静→動 | 江戸の宿で出発の準備 |
| 3 | 第1レグ | 動 | 山道を疾走 |
| 4 | 食事休憩 | 静 | 茶屋で握り飯 |
| 5 | 関門突破 | 動 | 関所で書状提示 |
| 6 | 第2レグ：難所 | 動 | 川渡り or 峠越え |
| 7 | 到着・引き継ぎ | 動 | 次の飛脚に渡す |
| 8 | 締め（数字オチ） | 静 | 「3日でこの距離」 |

## 3. 浮世絵スタイル × Seedance の相性原則

PoC で「**動勢のある絵は動く、座像はほぼ動かない**」が判明。これを設計に焼く。

### 3.1 採用する型 / 避ける型

| 浮世絵の型 | Seedance 適性 | 採用 |
|------------|---------------|------|
| 役者絵（見得を切る） | ◎ | ✓ |
| 武者絵（合戦） | ◎ | ✓ |
| 風俗画（庶民の生活） | ◎ | ✓ |
| 風景画（北斎・広重） | ◎ | ✓ |
| 美人画（座像） | △ | （限定的に） |
| 絹本肖像画 | ✗ ほぼ動かない | **scene-plan で生成しない** |

### 3.2 動勢タグ仕様

各シーンに動作タグを付け、(画像追加プロンプト, Seedance プロンプト, camera_fixed) を引く。

| `action_tag` | 画像追加プロンプト（要約） | Seedance プロンプト（要約） | camera_fixed |
|--------------|----------------------------|------------------------------|---------------|
| `running_forward` | running pose, mid-stride, hair streaming back | runs forward, legs alternating, scenery passes | false |
| `eating_meal` | seated, bowl in hand, chopsticks to mouth | brings food to mouth, chews slowly | true |
| `drawing_sword` | battle stance, hand on hilt | pulls sword from sheath, cape flares | false |
| `walking_carrying` | mid-step with load on shoulder | walks forward, load sways slightly | false |
| `sleeping` | lying down, eyes closed | subtle breathing motion | true |
| `crowd_cheering` | crowd of people, hands raised | crowd cheers, banners flutter | true |
| `weather_dynamic` | dramatic weather background | rain falls, lightning flashes, wind blows | true |
| `still_subtle` | dynamic-but-stationary composition | gentle wind, slight camera push-in | true |

詳細プロンプトは `packages/channels/ukiyoe/prompts/video-prompt-actions.md` で管理。

### 3.3 浮世絵スタイル強制

全 image-gen に以下を必須プレフィクスとして注入：

```
Style: Ukiyo-e woodblock print, Edo period, Japanese traditional illustration.
Bold black outlines, flat color planes, dramatic composition with strong diagonals.
Vivid traditional pigments (vermillion, indigo, gold leaf accents).
Dynamic moment captured mid-action.
Background with movable elements (clouds, smoke, waves, lightning, banners, foliage).
Avoid photorealism. Avoid still portrait composition.
```

詳細は `packages/channels/ukiyoe/prompts/image-prompt.md`。

## 4. 絶縁戦略

### 4.1 既存への変更は「拡張ポイントへの追記」のみ

| 既存ファイル | 変更内容 |
|--------------|---------|
| `packages/shared/src/channel.ts` | `CHANNEL_SUBJECT_DEFAULTS` に `ukiyoe: "歴史"` 追加（1 行） |
| `packages/renderer/src/Root.tsx` | `UkiyoeShort` の `<Composition>` を追加（既存 2 つは無傷） |
| `packages/pipeline/src/cli.ts` | `ukiyoe-*` コマンドを追加（既存コマンドは無傷） |

これら以外の既存ファイルには **論理的な変更を加えない**。

### 4.2 新規ファイル

```
packages/channels/ukiyoe/
  prompts/
    research.md
    script-routine.md
    scene-plan-routine.md
    image-prompt.md
    video-prompt-actions.md
  docs/
    style-guide.md

packages/pipeline/src/
  ukiyoe-paths.ts
  ukiyoe-script-generator.ts
  ukiyoe-scene-planner.ts
  ukiyoe-image-generator.ts
  ukiyoe-video-generator.ts
  ukiyoe-plan-builder.ts

packages/renderer/src/
  compositions/UkiyoeShort.tsx
  components/VideoSceneClip.tsx

packages/shared/src/
  schemas/ukiyoe-plan.ts

data/ukiyoe/                  # 自動生成
  scripts/<jobId>/{research.md, script.json, scene-plan.json,
                   images/scene-XX.png, videos/scene-XX.mp4,
                   narration.wav, ukiyoe-plan.json}
```

## 5. パイプラインフロー（CLI）

```
pnpm ukiyoe research       --topic "継飛脚"
  → pnpm ukiyoe script       --job <id>     # ルーティーン台本（8 シーン）
  → pnpm ukiyoe scene-plan   --job <id>     # 動勢タグ付与
  → pnpm ukiyoe images       --job <id>     # 浮世絵静止画 × 8
  → pnpm ukiyoe videos       --job <id>     # Seedance img2video × 8（並列）
  → pnpm ukiyoe tts          --job <id>     # ナレーション
  → pnpm ukiyoe build-plan   --job <id>     # ukiyoe-plan.json
  → pnpm ukiyoe render       --job <id>     # 完成 mp4
```

## 6. コスト試算

| 工程 | モデル | 単価 | 1本あたり（8 シーン） |
|------|--------|------|------------------------|
| 画像生成 | gpt-image-1 | $0.04 / 枚 | 約 50 円 |
| 動画生成 | Seedance 1.5 Pro 720p 無音 | $0.13 / 5秒 | 約 156 円 |
| TTS | Gemini TTS | – | 約 30 円 |
| **合計** | | | **約 240 円 / 本** |

月 10 本：約 2,400 円。`rekishi`（約 100 円/本）の 2.4 倍。

## 7. 実装フェーズ

| Phase | 内容 | 主な成果物 |
|-------|------|-----------|
| A. ドキュメント | 本ドキュメント | `docs/phases/ukiyoe.md` |
| B. 基盤 | チャンネル登録 + ディレクトリ雛形 | `shared/channel.ts`, `packages/channels/ukiyoe/` |
| C. パス & 動画生成 | `ukiyoe-paths.ts`, `ukiyoe-video-generator.ts` | PoC を本実装化 |
| D. 画像生成 | プロンプト + generator | 浮世絵スタイル統一 |
| E. シーン設計 + 台本 | `scene-plan-routine.md`, `script-routine.md`, planner | 動勢タグ付き 8 シーン |
| F. レンダリング | `UkiyoePlan` schema + `UkiyoeShort.tsx` | `<Video>` ベースのコンポ |
| G. CLI | `cli.ts` に `ukiyoe-*` 追加 | 一気通貫実行可 |
| H. 試作 | 「継飛脚の1日」end-to-end | 試作 mp4 + プロンプト調整 |

## 8. 関連リンク

- 中間 PR（PoC + ranking WIP）: <https://github.com/hibikun/rekishi-shorts/pull/20>
- PoC スクリプト: `packages/pipeline/src/poc-fal-video.ts`
- 参考動画: <https://www.youtube.com/watch?v=dHeRcrpP_N8>
