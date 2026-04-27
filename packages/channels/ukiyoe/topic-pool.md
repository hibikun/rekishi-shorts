# ukiyoe channel — topic pool

`pnpm ukiyoe-plan` で未使用上位 5 本を提示する元データ。
各エントリは「○○の1日」型ルーティーンとして 8 シーン × 5 秒に組み立てる前提。
動勢のある人物・職業・事件を選定。

## フォーマット

```
- [STATUS] `<slug>` <タイトル>
```

| STATUS | 意味 |
|--------|------|
| ` ` | 未着手（plan で候補表示される） |
| `~` | 着手中（jobId 確保済み、未投稿） |
| `✅` | 投稿済み（行末に jobId と URL 追記） |

slug は jobId に使われる（英数字とハイフンのみ。例: `ukiyoe-<slug>-<YYYY-MM-DD>`）。

---

## 戦国武将・武士

- [ ] `sanada-yukimura` 真田幸村 大坂夏の陣 最後の突撃の1日
- [ ] `uesugi-kenshin` 上杉謙信 川中島で信玄に斬りかかった1日
- [ ] `ishida-mitsunari` 石田三成 関ヶ原で西軍を率いた1日
- [ ] `naoe-kanetsugu` 直江兼続 直江状を書いた1日
- [ ] `takeda-shingen` 武田信玄 上洛途上で病に倒れた最後の1日
- [ ] `toyotomi-hideyoshi` 豊臣秀吉 中国大返しの1日 10日で200km
- [ ] `oda-nobunaga` 織田信長 桶狭間奇襲の1日
- [ ] `benkei` 弁慶 五条大橋で千人斬りに挑んだ1日
- [ ] `minamoto-yoshitsune` 源義経 一ノ谷の逆落とし 鵯越の1日
- [ ] `kato-kiyomasa` 加藤清正 朝鮮の地で虎を退治した1日
- [✅] `musashi` 宮本武蔵 巌流島の決闘の1日 — ukiyoe-musashi-2026-04-26 — https://youtube.com/shorts/jj92zzboU5I

## 幕末志士・事件

- [ ] `sakamoto-ryoma` 坂本龍馬 寺田屋を脱出した死線の1日
- [ ] `ii-naosuke` 井伊直弼 桜田門外で暗殺された1日
- [ ] `shinsengumi-ikedaya` 新選組 池田屋に踏み込んだ真夏の1日
- [ ] `takasugi-shinsaku` 高杉晋作 奇兵隊を率いて下関で戦った1日
- [ ] `saigo-takamori` 西郷隆盛 江戸城無血開城の1日
- [ ] `okita-soji` 沖田総司 池田屋で剣を振るった1日
- [ ] `hijikata-toshizo` 土方歳三 函館 五稜郭で散った最後の1日

## 江戸職人・庶民

- [ ] `machi-bikeshi` 町火消し いろは四十八組の1日
- [ ] `edo-tobi` 江戸の鳶職人 木遣りと纏振りの1日
- [ ] `bote-furi` 江戸の棒手振り 振売り商人の1日
- [ ] `hokusai-fugaku` 葛飾北斎 富嶽三十六景を描いた1日
- [ ] `hanaya-yohei` 華屋与兵衛 握り寿司を発明した1日
- [ ] `ichikawa-danjuro` 初代市川團十郎 荒事で江戸を沸かせた1日
- [ ] `hiroshige-tokaido` 歌川広重 東海道五十三次を描いた1日

## 歴史的事件・偉人逸話

- [ ] `ako-roshi` 大石内蔵助 赤穂浪士討ち入り 1702年12月14日の1日
- [ ] `taira-no-masakado` 平将門 関東独立を宣言した1日
- [✅] `ino-tadataka` 伊能忠敬 55歳から始めた測量の1日 — ukiyoe-ino-tadataka-2026-04-27 — https://youtube.com/shorts/9K6LxvNQfeE
- [ ] `basho-okuno-hosomichi` 松尾芭蕉 奥の細道へ江戸を旅立った1日
- [ ] `ninomiya-kinjiro` 二宮金次郎 薪を背負って読書した1日
- [ ] `saika-magoichi` 雑賀孫一 鉄砲集団・雑賀衆を率いた1日
- [ ] `katsushika-oi` 葛飾応為 父・北斎を超えた光と影を描いた1日
