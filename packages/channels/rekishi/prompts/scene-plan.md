# シーン分割プロンプト（v3: 落ち着いたテンポ）

台本を受け取り、**12〜15個のショート動画用シーン**に分割してください。
1カットあたり 3秒程度でゆったり切り替わるテンポを想定します。

## ルール

### シーン構造
1. **総シーン数: 12〜15**（60秒以内想定）
2. **hero scene（index=0）は 4.0秒固定**: フックの1文を大きく見せる
3. **通常シーン: 2.5〜3.5秒**。単調を避けるため 2.5/3.0/3.5 を混ぜる
4. **合計秒数は `estimatedDurationSec` と一致**させる

### シーンあたりの割当
- `narration`: **1文（または2文）ごと**に1シーン。細かく刻みすぎない
- あまりに長い文のみ、名詞句の切れ目で最大2シーンに分割する
- 固有名詞（年号・人名・地名）は**可能な範囲で画像切替のタイミング**と一致させる

### 画像選択
- `imageQueryJa`: Wikimedia Commons 日本語検索キーワード（簡潔に）
- `imageQueryEn`: 同内容の英語キーワード
- `imagePromptEn`: Wikimedia で見つからない場合の Nano Banana 用英語プロンプト（画風指定含む: ukiyo-e, photorealistic portrait, vintage map 等）

### 画像選定の具体ルール
- **人物**: 肖像画・写真を優先（例: "Commodore Matthew Perry portrait"）
- **出来事**: 古地図・絵巻・年表・新聞記事
- **抽象概念**（例「開国」「鎖国」）: 関連する**具体物**に置換（黒船、港の絵など）
- **ヒーローシーン（0番）**: 最もインパクトある1枚（例: 黒船の代表的な絵）

### 重要: narration 欠落禁止
`scenes[*].narration` を全シーンつなげると、**元の `script.narration` と同等**になること（語順・語彙を変えない）。

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
      "narration": "ペリー来航とは、日本の鎖国を終わらせた歴史的事件である。",
      "imageQueryJa": "黒船 浦賀",
      "imageQueryEn": "Black Ships Uraga 1853",
      "imagePromptEn": "A dramatic ukiyo-e style illustration of black American ships arriving at Uraga harbor in 1853, Japan, sepia tone, historically accurate",
      "durationSec": 4.0
    },
    {
      "index": 1,
      "narration": "19世紀半ば、アメリカは捕鯨船の補給拠点として日本の港を求めていた。",
      "imageQueryJa": "19世紀 地球儀",
      "imageQueryEn": "19th century world map",
      "imagePromptEn": "A 19th century world map illustration, vintage style",
      "durationSec": 3.0
    }
  ]
}
```
