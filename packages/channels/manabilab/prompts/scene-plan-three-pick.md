# シーン分割プロンプト（three-pick: 三選フォーマット）

三選台本を受け取り、**11〜14個のショート動画用シーン**に分割してください。
1カット 2.5〜4秒のゆったりテンポで、ランク切替のドラマ性を強調します。

## ルール

### シーン構造

| セクション | シーン数 | 合計秒数 | 備考 |
|---|---|---|---|
| A. フック (hero, index=0) | 1 | 3.0秒 | 三選のテーマを象徴する1枚 |
| B. 第3位 | 2〜3 | 約10秒 | 導入(人物肖像)→エピソード |
| C. 第2位 | 2〜3 | 約10秒 | 同上 |
| D. 第1位 | 3〜4 | 約15秒 | 最もドラマチックに |
| E. 締め | 1 | 2.0秒 | 余韻・次回予告 |

- **総シーン数: 11〜14**
- **hero scene（index=0）は 3.0秒固定**
- 通常シーンは 2.5〜4.0秒。ランク導入シーンは長め (3.5-4.0秒) にして印象付ける
- **合計秒数は `estimatedDurationSec`（45秒前後）と一致させる**

### シーンあたりの割当

- `narration`: 1文ずつ1シーンが基本。長い文は名詞句で切って2シーンに
- 「第3位、」「第2位、」「第1位、」で始まる文は **必ずその人物の最初のシーン** に割り当てる
- 固有名詞（人名・地名・年号）は画像切替のタイミングと一致させる

### 画像選択 — 単調化を避ける

各ランクの画像は **肖像 → エピソード関連 → 文脈** の3バリエーション構成を目指す:

1. **ランク導入シーン（各ランクの1枚目）**: 人物肖像画・写真を最優先
2. **エピソードシーン**: 事件現場・凶器・書状・関連建物など具体物
3. **文脈シーン（3枚目以降があれば）**: 時代の地図・関連人物・象徴的な絵画

### 画像選定の具体ルール

- **人物**: 肖像画・写真を優先（例: "Ito Hirobumi portrait"）
- **事件・暗殺現場**: 浮世絵・錦絵・現場写真・当時の新聞記事
- **抽象概念**: 関連する具体物に置換
- **hero scene (index=0)**: 三選のテーマを象徴する1枚
  - 個別人物画像では三選全体を代表できないことが多い。その場合は `imagePromptEn` でドラマチックな導入ビジュアルを指定（例: "dramatic silhouette of three historical figures in sepia tone"）
- **締めシーン**: 象徴的・抽象的な1枚（例: 夕焼けの城、時代を象徴する地図）

### 画風指示

- `imagePromptEn` にはエンタメ性を高める画風指定を入れる
  - `ukiyo-e style`, `dramatic chiaroscuro`, `sepia tone`, `cinematic lighting`, `vintage photograph`, `historical illustration` 等
- 人物は **肖像画ベース** を優先（ドラマ性のある肖像が望ましい）

### 重要: narration 欠落禁止

`scenes[*].narration` を全シーンつなげると、**元の `script.narration` と完全一致**すること（語順・語彙を変えない）。

## 入力

Topic: {{topic.title}} ({{topic.era}}, {{topic.subject}})
Narration:
"""
{{narration}}
"""

## 出力

```json
{
  "scenes": [
    {
      "index": 0,
      "narration": "暗殺された日本の偉人三選。最後は誰もが知るあの人物だ。",
      "imageQueryJa": "幕末 暗殺",
      "imageQueryEn": "Bakumatsu assassination historical",
      "imagePromptEn": "A dramatic sepia-toned silhouette of three historical Japanese figures in period attire, cinematic chiaroscuro lighting, mysterious atmosphere",
      "durationSec": 3.0
    },
    {
      "index": 1,
      "narration": "第3位、大村益次郎。",
      "imageQueryJa": "大村益次郎 肖像",
      "imageQueryEn": "Omura Masujiro portrait",
      "imagePromptEn": "A formal portrait of Omura Masujiro, Japanese military strategist of late Edo period, dramatic lighting, vintage photograph style",
      "durationSec": 4.0
    }
  ]
}
```
