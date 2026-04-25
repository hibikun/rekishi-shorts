# 商品ランキングショート シーン分割プロンプト（three-pick 固定）

三選ランキング台本を受け取り、**必ず 8 個のショート動画用シーン**に分割してください。
各ランクは「商品紹介ショット → レビューコメント重ねショット」の2カット構成を基本とします。

## 絶対遵守ルール（破ると後段の整合パイプラインが失敗します）

1. **シーン数は厳密に 8 個**。7 や 9 は不可。下表の index 0〜7 をすべて埋めること
2. **`scenes[*].narration` を index 順に全て連結すると、入力 `narration` と一字一句完全一致**すること
   - 句読点・空白・記号も含めて欠落・追加・改変いっさい不可
   - 文の途中で割って境界をまたいでも良いが、文字列全体は元と同一
3. シーンの **意味境界** は次の通り（必ず守る）:
   - index 1 (第3位 商品紹介) は「第3位、…」で始まる
   - index 3 (第2位 商品紹介) は「第2位、…」で始まる
   - index 5 (第1位 商品紹介) は「第1位、…」で始まる
   - index 7 (締め) は概要欄誘導や保存促し等の締め文

## ルール

### シーン構造（固定 8 シーン）

| index | セクション | 秒数 | 画面 |
|---|---|---|---|
| 0 | オープニング | 3.0秒 | タイトル全面テロップ + いらすとや風アイコン + ブラー背景 |
| 1 | 第3位 商品紹介 | 3.5秒 | 第3位テロップ + 商品名 + 商品画像矩形 |
| 2 | 第3位 レビュー | 4.0秒 | 第3位テロップ + 商品画像の上にレビューコメント3枚オーバーレイ |
| 3 | 第2位 商品紹介 | 3.5秒 | 第2位テロップ + 商品名 + 商品画像矩形 |
| 4 | 第2位 レビュー | 4.0秒 | 同上 |
| 5 | 第1位 商品紹介 | 4.0秒 | 第1位テロップ + 商品名 + 商品画像矩形 |
| 6 | 第1位 レビュー | 5.0秒 | 同上、最も長く |
| 7 | 締め | 2.5秒 | 概要欄誘導・保存促しテロップ |

- **総秒数は台本の estimatedDurationSec と一致させる**（通常 40秒前後）
- 画像は商品ごとに1枚（商品画像）あればよく、各シーンで使い回す
- オープニングのブラー背景は**全シーン共通**のテンプレ素材を指定

### 画像選定

- `imageQueryJa`, `imageQueryEn`: 商品公式ページ / Amazon画像の検索語
- `imagePromptEn`: 商品画像が入手できない場合の生成用プロンプト（**使用は最後の手段**）
  - 商品はメーカー公式画像 / Amazon プロダクト画像を優先
  - メーカー公式画像の利用可否は **リサーチ段階で確認済みのものに限る**
- **ブラー背景**: リサーチ段階で決まった統一背景素材を `imageQueryJa` に "店舗 家電量販店 ぼかし" 等で指定

### 重要: narration 欠落禁止（再掲）

`scenes[*].narration` を全シーンつなげると、**元の `script.narration` と完全一致**すること。
後段の Whisper word-level alignment がこの前提で動作するため、欠落・追加は致命的なズレになります。

## 入力

Topic: {{topic.title}} ({{topic.era}}, {{topic.subject}})
Narration:
"""
{{narration}}
"""
Items:
{{items}}

## 出力

```json
{
  "scenes": [
    {
      "index": 0,
      "narration": "5,000円以下で生活がガチで捗る神商品3選。",
      "imageQueryJa": "家電量販店 夜 ぼかし",
      "imageQueryEn": "blurred electronics store night",
      "imagePromptEn": "A dark, deeply blurred photograph of a Japanese electronics store aisle at night, bokeh, warm orange and blue lighting",
      "durationSec": 3.0
    },
    {
      "index": 1,
      "narration": "第3位、電動爪切り。",
      "imageQueryJa": "電動爪切り 商品画像",
      "imageQueryEn": "electric nail clipper product photo",
      "imagePromptEn": "",
      "durationSec": 3.5
    }
  ]
}
```
