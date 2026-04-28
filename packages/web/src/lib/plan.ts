import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Overlay {
  text: string;
  position?: "top" | "center" | "bottom";
  color?: "red" | "white" | "yellow" | "pink";
  fontSize?: number;
}

export interface ImageScene {
  index: number;
  kind: "image";
  beat: string;
  startSec: number;
  endSec: number;
  narration: string;
  imagePath: string;
  overlay?: Overlay;
  seedancePrompt: string;
  seedanceClipPath?: string | null;
  approved: boolean;
}

export interface TitleCardScene {
  index: number;
  kind: "title-card";
  beat: string;
  startSec: number;
  endSec: number;
  narration: string;
  titleCardKind: "method-1" | "method-2" | "spirit-vs-science";
  methodName?: string;
  approved: boolean;
}

export type SceneSpec = ImageScene | TitleCardScene;

export interface PlanAudio {
  path: string;
  voiceProvider: string;
  voiceId?: number;
  voiceName?: string;
  speedScale?: number;
  intonationScale?: number;
}

export interface ManabilabPlan {
  id: string;
  title: string;
  totalDurationSec: number;
  audio: PlanAudio;
  scenes: SceneSpec[];
}

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

export function planJsonPath(channelSlug: string, planId: string): string {
  return path.join(
    REPO_ROOT,
    "packages",
    "channels",
    channelSlug,
    "plans",
    `${planId}.json`,
  );
}

export async function loadPlan(channelSlug: string, planId: string): Promise<ManabilabPlan> {
  const filepath = planJsonPath(channelSlug, planId);
  const raw = await readFile(filepath, "utf-8");
  return JSON.parse(raw) as ManabilabPlan;
}

/**
 * 画像 path（"packages/channels/manabilab/assets/...") を public 配下の URL に変換。
 * web/public/manabilab → channels/manabilab/assets の symlink を前提とする。
 */
export function imagePathToUrl(channelSlug: string, p: string): string {
  const prefix = `packages/channels/${channelSlug}/assets/`;
  if (p.startsWith(prefix)) return `/${channelSlug}/${p.slice(prefix.length)}`;
  // フォールバック: そのまま返す
  return p;
}
