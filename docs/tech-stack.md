# 技術スタック

## 採用技術と選定理由

### AI パイプライン（各工程で最適モデルを使う方針）

| 工程 | モデル / サービス | 選定理由 |
|------|-----------------|---------|
| **トピック→台本** | Gemini 3.1 Pro | コスト・品質バランス最適（Claude Opus比1/10）。受験範囲は教科書レベルなので幻覚リスク許容可能。grounding で年号検証可能。 |
| **シーン設計** | Gemini 3.1 Flash | 構造化出力（responseSchema）が安定。最安。 |
| **ナレーション TTS** | **ElevenLabs `eleven_multilingual_v2`** | 日本語品質が業界最高。間・抑揚が自然で受験生の記憶定着に貢献。 |
| **実写/史料画像** | Wikimedia Commons API | CC/PD の歴史画像が豊富。受験教材と同じソースが使える。無料。 |
| **B-roll 補完画像** | Nano Banana 2 (Gemini 3.1 Flash Image) | Wikimedia に無いシーン補完。世界知識付きで整合性高い。$0.039/枚。 |
| **字幕タイムスタンプ** | OpenAI Whisper API | `word_timestamps` 対応。カラオケ字幕用。 |
| **BGM** | ❌ 採用せず | 教育系はBGM無しの方が定着率高い説。効果音のみ。 |

### アプリケーション / インフラ

| 層 | 技術 | 備考 |
|---|------|------|
| Monorepo | pnpm workspaces (Node 22) | `kirinuki-automate` と同パターン |
| Web | Next.js 16 App Router + React 19 + Tailwind v4 | Phase 1以降 |
| Renderer | Remotion 4 | 縦1080×1920 / 30fps |
| Worker | Fly.io (performance-2x, nrt, 4GB) | Phase 1以降。Dockerfileは `kirinuki-automate` 流用 |
| Auth | Supabase Auth | Phase 1以降 |
| DB | Supabase Postgres | Phase 1以降 |
| Storage | Supabase Storage | 最終 mp4 と中間成果物 |
| 決済 | Stripe | Phase 3のみ |
| 型 / バリデーション | Zod | 全packageで共有 |

### 選定で却下した候補

| 候補 | 却下理由 |
|------|---------|
| Claude Opus 4.7（台本用） | コスト10倍。受験歴史では Gemini 3.1 Pro で十分な品質。 |
| Gemini 3.1 Flash TTS | ElevenLabs の日本語品質が上。ブランド差別化のため音声品質は投資ポイント。 |
| Lyria 3（BGM） | BGM自体を不採用。preview料金未確定もリスク。 |
| GPT-5.4（台本用） | SimpleQAリードだが日本語文章の自然さでGemini 3.1 Proに劣ることがある。 |
| whisper.cpp（ローカル） | Fly.io worker に重量バイナリ積むより API の方が運用楽。 |

## 必要な API キー

| サービス | 取得先 | Phase |
|---------|--------|-------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) | 0〜 |
| `ELEVENLABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io/) | 0〜 |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/) | 0〜 |
| Wikimedia | 不要（User-Agent ヘッダのみ） | 0〜 |
| Supabase URL/ANON/SERVICE KEY | [supabase.com](https://supabase.com/) | 1〜 |
| Fly.io API token | `flyctl auth token` | 1〜 |
| Stripe keys | [stripe.com](https://stripe.com/) | 3〜 |
| YouTube Data API クライアント | Google Cloud Console | 2〜 |

## コスト試算（60秒 1本あたり）

| 項目 | コスト |
|------|--------|
| 台本 Gemini 3.1 Pro | ~¥1.3 |
| シーン設計 Gemini 3.1 Flash | ~¥0.3 |
| ElevenLabs TTS（400文字） | ~¥60 |
| Nano Banana 2 × 10枚 | ~¥60 |
| Wikimedia | ¥0 |
| Whisper API | ~¥1 |
| Fly.io worker（6分稼働） | ~¥15（Phase 1+） |
| **合計** | **~¥140/本**（Phase 0 は ~¥125/本、ローカルrenderのため） |

## スケール時のコスト想定

| 月次本数 | 原価 | 備考 |
|---------|------|------|
| 30本（自分） | ~¥4,200 | Phase 0-2 |
| 300本（試行期） | ~¥42,000 | Phase 3 クローズドβ |
| 3,000本（初期SaaS） | ~¥420,000 | Phase 3 + ElevenLabs Scale プラン |

ElevenLabs がボトルネック。Phase 3で月3,000本を超える場合、Gemini 3.1 Flash TTS への切り替え or プラン別TTS（Free=Gemini, Pro=ElevenLabs）が必要になる。
