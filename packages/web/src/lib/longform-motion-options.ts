/**
 * 長尺動画 (self-motivation 等) 用のシーン単位モーションプリセット。
 *
 * id は LongformVideo Composition 内の switch と一致させること。
 * UI からは label / description だけ使用。
 */
export interface LongformMotionPreset {
  id: string;
  label: string;
  description: string;
}

export const LONGFORM_MOTION_PRESETS: LongformMotionPreset[] = [
  {
    id: "auto",
    label: "自動",
    description: "シーン index ベースで Ken Burns パターンを循環適用",
  },
  {
    id: "ken-burns-slow",
    label: "Ken Burns (slow)",
    description: "ゆっくりとした寄り/引き。説明シーン向け",
  },
  {
    id: "ken-burns-fast",
    label: "Ken Burns (fast)",
    description: "やや速めの寄り/引き。リズムが欲しい場面に",
  },
  {
    id: "pop-in",
    label: "Pop In",
    description: "スケールアップで強調登場。章の切替や核心シーン向け",
  },
  {
    id: "soft-fade",
    label: "Soft Fade",
    description: "ゆるやかにフェードイン。落ち着いた情景に",
  },
  {
    id: "drift",
    label: "Drift",
    description: "ゆれるような微小な動き。瞑想的なシーン向け",
  },
  {
    id: "static",
    label: "Static",
    description: "動きなし。データ図解などをじっくり見せる場面",
  },
];

export function findLongformMotionPreset(
  id: string,
): LongformMotionPreset | undefined {
  return LONGFORM_MOTION_PRESETS.find((p) => p.id === id);
}
