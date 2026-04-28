/**
 * Manabilab plan-driven Remotion render の thin wrapper。
 *
 * - plan JSON を読んで `renderManabilabShort()` (renderer) を呼ぶだけ
 * - web layer (`@rekishi/web`) からは pipeline 経由で利用される
 *   (web は @rekishi/renderer に直接依存しないため、bundler の都合上 pipeline を経由)
 */
import path from "node:path";
import fs from "node:fs/promises";
import { renderManabilabShort } from "@rekishi/renderer";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../",
);

export interface RenderManabilabPlanOptions {
  /** チャンネル slug。default "manabilab" */
  channelSlug?: string;
  /** 出力 mp4 の絶対パス。指定しなければ assets/videos/{title}-{planId}.mp4 を自動生成 */
  outputPath?: string;
  /** Remotion の進捗（0-1）コールバック */
  onProgress?: (progress: number) => void;
}

export interface RenderManabilabPlanResult {
  /** 出力された mp4 の絶対パス */
  outputPath: string;
  /** Repo root からの相対パス */
  outputRelPath: string;
  /** 動画の長さ（秒） */
  totalDurationSec: number;
  /** 何シーン合成されたか */
  sceneCount: number;
}

interface PlanLite {
  id: string;
  title: string;
  totalDurationSec: number;
  audio: { path: string };
  scenes: Array<{
    index: number;
    kind: "image" | "title-card";
    startSec: number;
    endSec: number;
    narration: string;
    imagePath: string;
    overlay?: {
      text: string;
      position?: "top" | "center" | "bottom";
      color?: "red" | "white" | "yellow" | "pink";
      fontSize?: number;
    };
  }>;
}

/**
 * 動画ファイル名に使えるよう、スラッシュやコロンなど filesystem-unsafe な文字を除去。
 * 日本語タイトルはそのまま残し、視覚的に分かりやすい名前にする。
 */
function sanitizeFilenamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|\n\r]/g, "").trim();
}

export async function renderManabilabPlan(
  planId: string,
  opts: RenderManabilabPlanOptions = {},
): Promise<RenderManabilabPlanResult> {
  const channelSlug = opts.channelSlug ?? "manabilab";

  const planPath = path.join(
    REPO_ROOT,
    "packages",
    "channels",
    channelSlug,
    "plans",
    `${planId}.json`,
  );
  const raw = await fs.readFile(planPath, "utf-8");
  const plan = JSON.parse(raw) as PlanLite;

  // 出力先決定
  const filename = opts.outputPath
    ? null
    : `${sanitizeFilenamePart(plan.title)}-${planId}.mp4`;
  const outputAbsPath = opts.outputPath
    ? opts.outputPath
    : path.join(
        REPO_ROOT,
        "packages",
        "channels",
        channelSlug,
        "assets",
        "videos",
        filename!,
      );

  // image scene のみ render 対象（title-card は今のところ未使用想定だがフィルタしておく）
  const sceneCount = plan.scenes.filter((s) => s.kind === "image").length;

  await renderManabilabShort({
    plan,
    planId,
    repoRoot: REPO_ROOT,
    outputPath: outputAbsPath,
    onProgress: opts.onProgress,
  });

  const relPath = path.relative(REPO_ROOT, outputAbsPath);
  return {
    outputPath: outputAbsPath,
    outputRelPath: relPath,
    totalDurationSec: plan.totalDurationSec,
    sceneCount,
  };
}
