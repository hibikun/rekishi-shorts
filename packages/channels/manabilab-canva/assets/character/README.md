# manabilab-canva キャラ参照画像

画像生成時に「同一キャラ」のポーズ違いを安定生成するための参照画像置き場。

## ファイル

- **`reference.png`** — 新キャラの **構造リファレンス**（faceless / マスク型ヘッド / 細スリット目 / マッチョ体型）。色や服装は無視し、構造だけ参照する用途
- **`manabikun-base.png`** — 各シーン画像生成で `referenceImages` として渡される **ブランド規範ショット**。全身・正面・neutral standing・純白背景・新マナビくん仕様

## 新マナビくん仕様（要点）

- Faceless 卵型ヘルメットヘッド、コーラルピンク
- 額に **白い脳シルエットマーク**（左右半球の正面ビュー、文字なし）
- 細い斜めスリット目 2 本
- マッチョ体型、上半身裸、ディープマゼンタ膝丈ショーツ、裸足
- 純白背景、フラット 2D + バーガンディ太線

詳細は `packages/channels/manabilab-canva/prompts/character-base.md` を参照。

## 再生成方法

### Web UI から
ImagesStep の **「⟲ ベース画像を再生成」** ボタン → 確認ダイアログ → API が `regenerateCharacterBase()` を実行 → `manabikun-base.png` 上書き

### API 直接
```bash
curl -X POST http://localhost:3030/api/manabilab-canva/character/regenerate-base
```

### キャラを刷新したい時
1. 新しい構造リファレンスを `reference.png` に上書き保存
2. `prompts/character-base.md` の仕様を新キャラに書き直す
3. 「ベース画像を再生成」ボタン押下
4. 結果を確認し、必要なら `character-base.md` を微調整して再再生成
5. シーン画像生成プロンプト（`prompts/image-prompt.md`）の **キャラ規範ヘッダ** も同じ仕様に書き換え（重要）
