import fs from "node:fs";
import path from "node:path";
import {
  RankingPlanSchema,
  ScriptSchema,
  type AudioClip,
  type RankingItem,
  type RankingPlan,
  type Scene,
  type Script,
} from "@rekishi/shared";

export interface BuildRankingPlanInput {
  script: Script;
  backgroundImagePath: string;
  /** rank 1, 2, 3 の順番で並べた商品画像パス */
  itemImagePaths: [string, string, string];
  /** opening 下部に表示するキャラ/ロゴ画像（最大 3 枚）。空配列なら非表示 */
  openingIconImagePaths?: string[];
  audioPath?: string;
  bgmPath?: string;
  rankSfxPath?: string;
  hookSfxPath?: string;
  id?: string;
  totalDurationSec?: number;
  /**
   * scene-aligner で実音声に合わせて durationSec を上書き済みの Scene 列。
   * 与えると RankingShort 側でスライド進行が TTS と同期する。
   * 未指定時はコンポ側の固定尺フォールバックが使われる（後方互換）。
   */
  scenes?: Scene[];
  /**
   * セグメント別 TTS で生成された audioClips マニフェスト（案G改）。
   * 与えられている場合、レビュー吹き出しの登場タイミングが startSec ベースで決まる。
   */
  audioClips?: AudioClip[];
}

function ensureRankingScript(
  script: Script,
): asserts script is Script & { items: NonNullable<Script["items"]> } {
  if (script.topic.format !== "three-pick") {
    throw new Error(
      `build-ranking-plan requires three-pick format script (got ${script.topic.format})`,
    );
  }
  if (!script.items || script.items.length < 3) {
    throw new Error(
      `script.items must have 3 entries (got ${script.items?.length ?? 0})`,
    );
  }
}

function buildOpeningLines(script: Script): RankingPlan["opening"]["lines"] {
  // 新仕様: title.bottom にメインタイトルを書き、改行位置に "/" を入れる規約。
  // "/" を改行に変換し、空白行は除外する。title.top は後方互換のため空でなければ
  // small-white で残す（旧ジョブ向け）。
  const lines: RankingPlan["opening"]["lines"] = [];
  const top = (script.title.top ?? "").trim();
  if (top.length > 0) {
    lines.push({ text: top, variant: "small-white" });
  }
  const bottomRaw = (script.title.bottom ?? "").trim();
  if (bottomRaw.length > 0) {
    const bottom = bottomRaw.replace(/\s*\/\s*/g, "\n");
    lines.push({ text: bottom, variant: "gold" });
  }
  return lines;
}

function toRankingItem(
  script: Script & { items: NonNullable<Script["items"]> },
  rank: 1 | 2 | 3,
  productImagePath: string,
): RankingItem {
  const it = script.items.find((x) => x.rank === rank);
  if (!it) throw new Error(`script.items missing rank ${rank}`);
  if (!it.brand) throw new Error(`script.items[rank=${rank}].brand is required`);
  if (!it.category)
    throw new Error(`script.items[rank=${rank}].category is required`);
  if (!it.reviews || it.reviews.length !== 3)
    throw new Error(
      `script.items[rank=${rank}].reviews must be exactly 3 entries`,
    );
  return {
    rank,
    brand: it.brand,
    category: it.category,
    productImagePath,
    reviews: it.reviews,
    priceRangeJpy: it.priceRangeJpy,
    affiliateUrl: it.affiliateUrl,
    productName: it.name,
  };
}

export function buildRankingPlan(input: BuildRankingPlanInput): RankingPlan {
  const { script } = input;
  ensureRankingScript(script);

  const items: [RankingItem, RankingItem, RankingItem] = [
    toRankingItem(script, 1, input.itemImagePaths[0]),
    toRankingItem(script, 2, input.itemImagePaths[1]),
    toRankingItem(script, 3, input.itemImagePaths[2]),
  ];

  const id = input.id ?? `ranking-${Date.now()}`;
  // scenes が与えられていれば、その合計を真の動画尺として採用する
  // (実音声と一致するため)。なければ script の推定値にフォールバック。
  const scenesTotalSec = input.scenes
    ? input.scenes.reduce((sum, s) => sum + s.durationSec, 0)
    : undefined;
  const totalDurationSec =
    input.totalDurationSec ??
    scenesTotalSec ??
    script.estimatedDurationSec ??
    30;

  const iconPaths = input.openingIconImagePaths ?? [];
  const openingIcons =
    iconPaths.length > 0
      ? iconPaths.slice(0, 3).map((src) => ({ src }))
      : undefined;

  return RankingPlanSchema.parse({
    id,
    opening: {
      lines: buildOpeningLines(script),
      icons: openingIcons,
    },
    items,
    backgroundImagePath: input.backgroundImagePath,
    closing: { text: script.closing },
    totalDurationSec,
    audioPath: input.audioPath,
    bgmPath: input.bgmPath,
    rankSfxPath: input.rankSfxPath,
    hookSfxPath: input.hookSfxPath,
    captions: [],
    captionSegments: [],
    scenes: input.scenes,
    audioClips: input.audioClips,
    createdAt: new Date().toISOString(),
  });
}

export function readScriptFile(scriptPath: string): Script {
  const raw = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
  return ScriptSchema.parse(raw);
}

export function writeRankingPlan(plan: RankingPlan, outputPath: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(plan, null, 2));
}
