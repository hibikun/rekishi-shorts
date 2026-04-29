/**
 * SelfMotivation 長尺動画レンダリングの thin wrapper。
 * 実装本体は @rekishi/renderer 側 (renderer/src/render.ts) にある。
 * pipeline は web layer から呼ばれる際に @rekishi/renderer を経由するためここで再エクスポート。
 */
import {
  renderSelfMotivationVideo,
  type RenderSelfMotivationOptions,
} from "@rekishi/renderer";

export { renderSelfMotivationVideo };
export type { RenderSelfMotivationOptions };
