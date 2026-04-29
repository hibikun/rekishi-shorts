# manabilab-canva

学びラボ系ショート動画の **素材** だけを AI で生成し、最終アニメーションと SE は Canva で人間が手動で組み立てるハイブリッド・チャンネル。

## フロー

```
[1] Topic     ← 人間が入力（テンプレ提案あり）
[2] Research  ← Gemini + Google Search → markdown
[3] Script    ← Gemini で台本生成 + 人間が編集
[4] Scenes    ← scene 割（後フェーズ）
[5] Images    ← Nano Banana per scene（後フェーズ）
[6] TTS       ← VOICEVOX per scene（連結なし。後フェーズ）
[7] Export    ← Canva インポート用 ZIP（後フェーズ）
```

## ディレクトリ

- `prompts/`            — research.md / script.md（manabilab を流用）
- `jobs/{jobId}/`       — ジョブ単位の永続化
  - `job.json`          — Single Source of Truth (zod ManabilabCanvaJobSchema)
  - `research.md`       — リサーチ結果
  - `script.json`       — 台本（Script スキーマ）

## 使い方

Web UI から `/manabilab-canva` で新規ジョブを作成し、ステップウィザードに従って進める。
