# シーン分割プロンプト

台本を受け取り、Ken Burnsエフェクトで見せる10〜15個のシーンに分割してください。

## ルール

1. 各シーンは **3〜6秒** 程度の長さ
2. **合計秒数は `estimatedDurationSec` と一致** させる
3. 各シーンに以下を付与:
   - `narration`: そのシーンで話すナレーション部分（台本のほぼ連続したスライス）
   - `imageQueryJa`: Wikimedia Commons 検索用の日本語キーワード（簡潔に）
   - `imageQueryEn`: 同じ内容の英語キーワード
   - `imagePromptEn`: Wikimedia に適した画像が無い場合に Nano Banana で生成するための英語プロンプト（historical illustration, ukiyo-e style, realistic portrait など画風指定含む）
   - `durationSec`: 秒数
4. **narration を繋ぐと元台本と一致** すること（情報欠落・順序変更なし）
5. 人物や出来事のシーンは **肖像画・古写真・古地図** が検索できるキーワードを優先
6. 抽象的概念（例: 「開国」）は具体物に置き換える（例: 黒船、港の絵）

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
      "narration": "...",
      "imageQueryJa": "黒船 浦賀",
      "imageQueryEn": "Black Ships Uraga Perry",
      "imagePromptEn": "A 19th century ukiyo-e illustration of black ships arriving at Uraga harbor, Japan, 1853",
      "durationSec": 4.0
    }
  ]
}
```
