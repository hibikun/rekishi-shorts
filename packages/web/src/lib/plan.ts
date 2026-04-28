import { readFile, writeFile } from "node:fs/promises";
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
  /**
   * このシーンの素材種別。再生成時の参照画像の渡し方を決める。
   * - "character": Nano Banana 呼び出し時に常に現在の画像を参照画像として渡し、ブランドキャラの見た目を保つ
   * - "broll": 参照なしで毎回フレッシュに生成（コンセプトを大きく変える前提）
   *
   * 既存プランで未設定の場合は path から推論される（assetKindFromPath を参照）。
   */
  assetKind?: "character" | "broll";
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

export interface PlanReading {
  /** 漢字／英字表記（例: "Walker"） */
  term: string;
  /** ひらがな or カタカナ読み（例: "ウォーカー"） */
  reading: string;
}

export interface ManabilabPlan {
  id: string;
  title: string;
  totalDurationSec: number;
  audio: PlanAudio;
  scenes: SceneSpec[];
  /**
   * 難読固有名詞の読みリスト。VOICEVOX のフリガナ反映 + Whisper の bias prompt に使う。
   */
  readings?: PlanReading[];
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

export async function savePlan(
  channelSlug: string,
  planId: string,
  plan: ManabilabPlan,
): Promise<void> {
  const filepath = planJsonPath(channelSlug, planId);
  await writeFile(filepath, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
}

export function repoRoot(): string {
  return REPO_ROOT;
}

/**
 * 旧プランの imagePath から assetKind を推論する後方互換ヘルパー。
 *
 * - `/character/` を含む → "character"
 * - `/brolls/` を含む → "broll"
 * - `/per-plan/` 配下（再生成済み）でどちらか分からない場合は "character" を返す
 *   （参照画像を渡す方が安全側 = キャラ崩れを避ける）
 */
export function assetKindFromPath(p: string): "character" | "broll" {
  if (p.includes("/character/")) return "character";
  if (p.includes("/brolls/")) return "broll";
  return "character";
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
