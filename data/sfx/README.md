# SFX (Sound Effects)

歴史ショートに自動で乗せる効果音をここに配置する。
ファイルが無ければ自動的にスキップされる（renderer は無音で進む）。

## 規約

| ファイル名 | 再生タイミング | 用途 | 音量 |
|---|---|---|---|
| `hyoshigi.mp3` | 動画 0.0 秒 | オープニング合図（拍子木「カン！」） | 0.6 |
| `wadaiko.mp3` | `scenes[0]` 終端（フック直後） | フック明けのインパクト（和太鼓ドン） | 0.6 |

両方置けば両方鳴り、片方だけでもOK。音量は `SfxAudio` のデフォルト 0.6（ナレーションの下に潜らせる）。

## おすすめ入手先（CC0 / 無料商用可）

1. **効果音ラボ** — https://soundeffect-lab.info/
   - 「拍子木」「和太鼓ドン」など。JP YouTuber 御用達。商用OK・クレジット任意
2. **Pixabay** — https://pixabay.com/sound-effects/
   - CC0、クレジット不要
3. **DOVA-SYNDROME 効果音** — https://dova-s.jp/se/
   - 商用OK
4. **OtoLogic** — https://otologic.jp/free/se/
   - 「拍子木」「柝」あり

ダウンロードしたファイルを上記の規約名にリネームしてここに置けばOK。
