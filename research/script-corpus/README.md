# script-corpus

ショート動画の脚本を体系的に分析・蓄積し、`packages/channels/*/prompts/script*.md` を改善するための研究用コーパス。

rekishi 専用ではなく、英語圏のバズショートも含めて**普遍的に効く脚本パターン**を抽出することを目的とする。

## 構成

```
research/script-corpus/
  videos/
    <channel-slug>__<video-id>/
      meta.json        # url, channel, title, views, likes, duration, lang, fetched_at
      transcript.json  # Whisper API の生レスポンス（segments + words）
      script.md        # タイムスタンプ付きの読みやすい台本
      analysis.md      # 構造分析（Gemini が下書き → 人が校正）
  patterns.md          # 全 analysis.md を蒸留した「効く技法」リスト（rekishi prompt から参照）
  index.md             # 全動画の一覧テーブル（再生数・ジャンル・気づきの一行サマリ）
```

mp3 などの音声ファイルは保持しない（Whisper後に削除）。再分析が必要なら URL から再取得する。

## ワークフロー

1. **追加**: `pnpm --filter @rekishi/pipeline corpus add <youtube-url>`
   - yt-dlp で音声抽出 → Whisper で文字起こし → meta.json + script.md + 空の analysis.md テンプレを生成
2. **分析下書き**: `pnpm --filter @rekishi/pipeline corpus analyze <slug>`
   - Gemini が transcript と meta から analysis.md の各セクションを下書き
   - 完了後 `status: draft`。人が校正したら frontmatter を `status: reviewed` に変更
3. **蒸留**: `pnpm --filter @rekishi/pipeline corpus distill`
   - `status: reviewed` の analysis.md を全て読んで `patterns.md` を再生成
   - 何本か校正が溜まったタイミングで実行

## analysis.md の使い方

各 analysis.md は以下のセクションを持つ共通スキーマ：

- **Beat構造**: 区間ごとの役割と内容（タイムスタンプ付き）
- **フック技法**: 分類タグ（否定 / 質問 / 数字 / 逆説 / 未来予告 / 情景 / 当事者発話 …）
- **好奇心ギャップ**: 設置と回収の地点
- **リフレイン・キーフレーズ**: 印象に残る反復語
- **文の長短リズム**: 平均語数/秒、最短文、最長文
- **クロージングの型**: 分類タグ
- **rekishi に転用できる原則**: ←ここが本命
- **メモ（人による校正）**: LLM が拾えなかった微差を人が書き加える

## patterns.md の使い方

`patterns.md` は corpus 全体から距離を取った「型集」。rekishi の `script.md` プロンプトから直接参照する形ではなく、**プロンプト改修時の参考資料**として使う。

明確に定着したパターンが出たら、`packages/channels/rekishi/prompts/script.md` の該当箇所に短く要約して取り込む。
