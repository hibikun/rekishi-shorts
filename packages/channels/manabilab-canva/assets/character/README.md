# manabilab-canva キャラ参照画像

画像生成時に「同一キャラ」のポーズ違いを安定生成するための参照画像置き場。

## 現在の参照画像

- `manabikun-base.png` — マナビくん基準ヒーローショット
  - 暫定で manabilab v1（`packages/channels/manabilab/assets/character/v1/01-hero-front-standing.png`）からコピー

## 差し替え手順

新しいマナビくんキャラに更新する場合：

1. 新キャラの基準画像（front facing, neutral pose, 純白背景推奨）を `manabikun-base.png` として上書き
2. ImagesStep でジョブごとに「画像を生成」を再実行（既存生成画像は手動で削除 or 上書き）

複数の参照ポーズを使いたくなった場合は、`pose-1.png`, `pose-2.png` ... と追加し、`packages/pipeline/src/manabilab-canva-image-prompt-generator.ts` 側で参照画像配列に含めるよう拡張する。
