# v3 実装計画（次セッション用）

> **使い方**: このファイルを新セッションで最初に読ませる。冒頭のプロンプト例は最下部 [👉 新セッション起動プロンプト](#-新セッション起動プロンプト) を参照。

## 背景

Phase 0 の E2E は v2 まで完走済み。v1 と v2 の生成は `data/videos/` 配下（v2 の最新ジョブ ID: `37200ae6`）。ユーザーからの v2 フィードバックを受けて v3 で下記4点を直す。

## v2 からのフィードバック（未着手の4点）

1. **人名の繰り返し読み上げ** — 台本に「阿部正弘（あべまさひろ）」と漢字＋ふりがな併記したため Gemini TTS が両方読んでしまう
2. **字幕がチカチカする** — word単位スライディング＋アクティブ語ハイライトで常に文字が動いている
3. **画像切替が速すぎ** — v2 は 24シーン×1.5-2.5秒/カット。ユーザー要望は **3秒/カット目安**（12-15シーン）
4. **冒頭0秒時点で字幕が出ない** — `currentSec < words[0].startSec` で null を返していた

**KeywordPopup（「1853年」「黒船」などが黄色ピルで飛び出す演出）は残す判断済み**。

---

## 実装タスク（合計 ~2.5h）

### Task 1: readings フィールド導入（45min）
**目的**: 台本は漢字のみ、難読語の読みは別マップで提供。TTS は読みで上書き、字幕は漢字のまま表示。

- `packages/shared/src/schemas/script.ts`:
  - `ScriptSchema` に `readings: z.record(z.string())` を追加（オプショナルではなく必須、空オブジェクトOK）
- `packages/pipeline/prompts/script.md`:
  - 「漢字＋ふりがな併記」を廃止
  - `narration` は漢字のみで自然な文章
  - 難読な人名・地名・歴史用語のみ `readings` で `{ "漢字表記": "ひらがな表記" }` 形式で返すよう指示
  - 良い例を更新
- `packages/pipeline/src/script-generator.ts`:
  - `responseSchema` に `readings: { type: OBJECT }` を追加（Gemini の構造化出力。Gemini が自由キーの map を返せない場合は `readings` を `Array<{term, reading}>` に変更して shared 側でマップに変換）

### Task 2: TTS 直前の readings 置換（15min）
- `packages/pipeline/src/tts-generator.ts`:
  - `synthesizeNarration` の `opts` に `readings?: Record<string, string>` を受け付ける
  - 既存の `applyFurigana` を流用（または `readings` と統合）
- `packages/pipeline/src/orchestrator.ts`:
  - TTS呼び出し時に `{ readings: script.readings, furigana: FURIGANA_MAP }` を渡す
  - 両方あれば先に readings、次に furigana を適用

### Task 3: CaptionSegment 型 + phrase導出（30min）
**目的**: scene ごとに phrase として字幕データを生成する。Whisper word[] は KeywordPopup 用に残す。

- `packages/shared/src/schemas/asset.ts`:
  - 新規 `CaptionSegmentSchema`: `{ text: string, startSec: number, endSec: number }`
  - 新規 `CaptionSegmentTrackSchema`: `{ segments: CaptionSegment[] }`
- `packages/shared/src/schemas/render-plan.ts`:
  - `RenderPlanSchema` に `captionSegments: CaptionSegment[]` を追加（既存の `captions: CaptionWord[]` は KeywordPopup 用に残す）
- `packages/pipeline/src/orchestrator.ts`:
  - rescaleScenes 後の scenes から以下を計算:
    ```
    let cursor = 0;
    const captionSegments = scenes.map((s) => {
      const seg = { text: s.narration, startSec: cursor, endSec: cursor + s.durationSec };
      cursor += s.durationSec;
      return seg;
    });
    ```
  - RenderPlan に保存

### Task 4: Caption コンポーネント差し替え（45min）
**目的**: kirinuki-automate `Caption.tsx` と同じ方針の、phrase単位で静的に表示するコンポーネント。

- `packages/renderer/src/components/KaraokeCaption.tsx` を **削除**
- 新規 `packages/renderer/src/components/Caption.tsx`:
  - `captionSegments: CaptionSegment[]` を props に取る
  - `currentSec` に該当する segment を1つ探して表示（`captions.find((c) => currentTime >= c.start && currentTime < c.end)`）
  - スタイルは kirinuki 方式に準拠: 下18%・白文字・黒 text-shadow 多重 (`0 0 10px #000, 0 0 6px #000, 0 0 4px #000`)・Noto Sans CJK JP・fontWeight 700・fontSize 64
  - アニメーション/ハイライトなし。シンプルな on/off のみ
  - 但し phrase 切替時の **急激な on/off 感を和らげるため**、 100ms 程度の opacity fade-in だけ入れる（任意、ユーザーがチカチカ嫌と言ってるので入れない判断でも可）
- `packages/renderer/src/compositions/HistoryShort.tsx`:
  - 既存 `KaraokeCaption` 呼び出しを `Caption` に差し替え
  - props は `captionSegments` を受ける
  - `KeywordPopup` は従来どおり `captions: CaptionWord[]` ベースで残す
- `packages/renderer/src/Root.tsx` の `defaultProps` に `captionSegments: []` 追加
- `packages/renderer/src/render.ts` の `inputProps` に `captionSegments: plan.captionSegments` 追加

### Task 5: scene-planner プロンプト調整（10min）
- `packages/pipeline/prompts/scene-plan.md`:
  - 「20〜25シーン」→「**12〜15シーン**」に変更
  - 「通常シーン 1.5〜2.5秒」→「**通常シーン 2.5〜3.5秒**」
  - 「hero scene 3.0秒固定」→「**hero scene 4.0秒固定**」

### Task 6: E2E 実行 + コスト比較（10min）
- `pnpm generate --topic "ペリー来航" --era "幕末"`
- Before (`37200ae6`) と比較
- 動画は `open data/videos/<id>.mp4` で試聴してフィードバックを得る

---

## 完了の定義（DoD）

- [ ] 「阿部正弘」が**1回だけ**読み上げられる（繰り返しなし）
- [ ] 字幕がフレーズ単位で**ほぼ静止**して表示される（チカチカしない）
- [ ] シーン数 12〜15、1カット 2.5〜3.5秒、hero 4秒
- [ ] **0秒時点で最初の phrase が字幕表示されている**
- [ ] KeywordPopup は従来どおり重要語ハイライト維持
- [ ] 合計コスト ¥30 前後（大幅増なし）
- [ ] typecheck 通過

---

## 変更しないもの（明示）

- 技術スタック（Gemini 3 Pro / Flash Lite / Flash TTS / Flash Image, Wikimedia, Whisper, Remotion 4）
- TTS voice (`Kore`)
- FlashTransition（v2 で導入済み、違和感なければそのまま）
- KenBurns（控えめ設定のまま）
- Ken Burnsと下部グラデーション

---

## 関連ファイル早見表

| 改修 | パス |
|------|------|
| schema | `packages/shared/src/schemas/script.ts` `asset.ts` `render-plan.ts` |
| prompts | `packages/pipeline/prompts/script.md` `scene-plan.md` |
| pipeline | `packages/pipeline/src/script-generator.ts` `tts-generator.ts` `orchestrator.ts` |
| renderer | `packages/renderer/src/components/Caption.tsx`（新規）、`compositions/HistoryShort.tsx`、`Root.tsx`、`render.ts` |

前回までの v2 実装コミット: `git log --oneline` で確認可能。

---

## 👉 新セッション起動プロンプト

次のセッションで以下をコピペして送ってください：

```
rekishi-shorts プロジェクト（~/Desktop/rekishi-shorts/）の Phase 0 v3 実装に着手したいです。

前セッションで v1→v2 までは完走済み。v2 の生成結果に対してユーザーから4点のフィードバックがあり、それを直すのが v3 の目的です。

具体的な改修計画・対象ファイル・完了条件は以下に完全記載してあるので、まず読み込んでから実装を開始してください:

  docs/v3-implementation-plan.md

読み込んだら以下の順で進めてください:
1. Task 1-5 をすべて実装（typecheck を都度通す）
2. Task 6 で E2E を実行
3. 完了後は kirinuki-automate と同じフォーマットでコミット

途中で仕様上の判断が必要になったら止めて確認してください。Auto mode で良いです。
```
