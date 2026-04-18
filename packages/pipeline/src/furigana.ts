/**
 * 固有名詞の TTS 誤読を防ぐための置換辞書。
 * ElevenLabs 日本語 TTS は漢字読みが弱いケースがあるため、必要に応じて追加。
 */
export const FURIGANA_MAP: Record<string, string> = {
  // 幕末
  "黒船来航": "くろふねらいこう",
  "浦賀": "うらが",
  // 世界史
  // "ヴェルサイユ": "ベルサイユ",
};
