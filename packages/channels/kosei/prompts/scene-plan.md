# 古生物ショート シーン分割プロンプト（v3: 落ち着いたテンポ）

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
- 固有名詞（学名・地層名・地質時代名）は**可能な範囲で画像切替のタイミング**と一致させる

### 画像選択
- `imageQueryJa`: Wikimedia Commons 日本語検索キーワード（簡潔に）
- `imageQueryEn`: 同内容の英語キーワード（学名はそのまま英字推奨、例: "Tyrannosaurus skeleton"）
- `imagePromptEn`: Wikimedia で見つからない場合の Nano Banana 用英語プロンプト（画風指定を含める: **paleoart illustration, scientific reconstruction, national geographic style, neutral background, museum quality**）

### 画像選定の具体ルール
- **生物本体**: 復元イラスト・骨格標本・化石写真を優先（例: "Tyrannosaurus rex reconstruction Paleoart", "Trilobite fossil"）
- **環境・生態**: 古環境復元図・生息域地図・系統樹
- **スケール比較**: 人間との大きさ比較図・他種との並列比較図（"Megalodon tooth size comparison"）
- **抽象概念**（例「進化」「絶滅」「適応」）: 関連する**具体物**に置換（化石標本、隕石、氷河、絶滅生物の並び）
- **ヒーローシーン（0番）**: 最もインパクトある1枚（例: ティラノの復元図アップ、メガロドンの顎骨）

### AI 生成プロンプトの注意
- 実際には存在しない組み合わせ（例: ティラノ vs メガロドン）を依頼しない。**単独の生物・骨格・復元図**をベースに
- 「paleoart」「scientific reconstruction」「neutral background」を必ず含め、安っぽいアニメ風にならないよう指示する

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
      "narration": "鳥は、絶滅しなかった恐竜である。",
      "imageQueryJa": "始祖鳥 化石",
      "imageQueryEn": "Archaeopteryx fossil",
      "imagePromptEn": "A photorealistic reconstruction of Archaeopteryx in flight, feathered transitional form between dinosaurs and birds, paleoart style, neutral museum background",
      "durationSec": 4.0
    },
    {
      "index": 1,
      "narration": "白亜紀末、巨大隕石により非鳥類型恐竜は一掃された。",
      "imageQueryJa": "K-Pg境界 隕石",
      "imageQueryEn": "Chicxulub impact Cretaceous extinction",
      "imagePromptEn": "A dramatic illustration of a massive asteroid impacting Earth at end of Cretaceous period, paleoart style, scientific reconstruction",
      "durationSec": 3.0
    }
  ]
}
```
