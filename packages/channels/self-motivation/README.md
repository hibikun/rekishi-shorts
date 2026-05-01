# self-motivation

自己啓発・キャリア科学・行動科学テーマの **長尺動画（16:9 / 1920×1080 / 最大 10 分）** を生成するチャンネル。

## フロー

```
[1] Topic     ← 人間が入力（NewJobForm）
[2] Research  ← Gemini + Google Search → markdown
[3] Script    ← Gemini で章立て台本生成（chapters[].narrationParagraphs[]）
[4] Scenes    ← 段落を句読点+budoux で 2-3 フレーズ単位に展開（Scene[]）
[5] Images    ← Nano Banana で 16:9 シンボリック画像 1 枚 / Scene
[6] TTS       ← Gemini TTS (Charon) で per-scene wav → ffmpeg で 1 本に結合
[7] Render    ← Remotion で 1920×1080 mp4 をバックグラウンド生成
```

## ディレクトリ

- `prompts/` — research.md / script.md / image-prompt.md
- `assets/bgm/` — BGM 配置場所（実体は別途配置・gitignore 管理）
- `jobs/{jobId}/` — ジョブ単位の永続化（gitignore 管理）
  - `job.json` — Single Source of Truth (`SelfMotivationJobSchema`)
  - `research.md` — リサーチ結果
  - `script.json` — 章立て台本（`SelfMotivationScriptSchema`）
  - `scenes.json` — Scene 配列（`SelfMotivationScenesSchema`）
  - `images/{sceneId}.png` — Scene 画像
  - `audio/{sceneId}.wav` — Scene 別 TTS
  - `audio/full.wav` — 結合済みナレーション
  - `render/output.mp4` — 完成動画
  - `render/status.json` — 背景レンダリング進捗

## 使い方

Web UI から `/self-motivation` で新規ジョブを作成し、Editor 画面で各ステップを実行する。
