import path from "node:path";
import fs from "node:fs/promises";
import { promptPath, channelAssetsDir } from "@rekishi/shared/channel";
import { generateImage } from "./image-generator.js";

export interface RegenerateCharacterBaseResult {
  outputPath: string;
  referenceUsed: boolean;
}

/**
 * manabilab-canva のキャラ "原典" ヒーローショットを Nano Banana で再生成する。
 *
 * - 入力プロンプト: prompts/character-base.md
 * - 参照画像: assets/character/reference.png（あれば）
 * - 出力: assets/character/manabikun-base.png（既存ファイルは上書き）
 *
 * 各ジョブのシーン画像生成はこの 1 枚を referenceImages として引き続けるため、
 * このベースが変わると全ジョブの絵柄が変わる点に注意。
 */
export async function regenerateCharacterBase(): Promise<RegenerateCharacterBaseResult> {
  const charDir = path.join(channelAssetsDir("character", "manabilab-canva"));
  const promptText = await fs.readFile(promptPath("character-base", "manabilab-canva"), "utf-8");
  const refPath = path.join(charDir, "reference.png");
  const destPath = path.join(charDir, "manabikun-base.png");

  let referenceUsed = false;
  let referenceImages: string[] | undefined;
  try {
    await fs.stat(refPath);
    referenceImages = [refPath];
    referenceUsed = true;
  } catch {
    referenceImages = undefined;
  }

  await generateImage(promptText, destPath, {
    referenceImages,
    // プロンプト内で 9:16 を明示しているので追加指定はしない
    appendAspectSuffix: false,
  });

  return { outputPath: destPath, referenceUsed };
}
