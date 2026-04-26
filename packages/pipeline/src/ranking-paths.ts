import fs from "node:fs";
import path from "node:path";
import { channelAssetsDir, channelDataPath } from "@rekishi/shared/channel";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const IMAGE_EXTENSIONS = ["png", "webp", "jpg", "jpeg"] as const;
const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "ogg"] as const;

export interface RankingJobPaths {
  jobId: string;
  root: string;
  scriptJson: string;
  nextStepsMd: string;
  planJson: string;
  assetsDir: string;
  narrationWav: string;
  scenePlanJson: string;
  wordsJson: string;
  /** セグメント別 TTS の個別クリップ群を置くディレクトリ */
  ttsClipsDir: string;
  /** セグメント別 TTS の audioClips マニフェスト JSON */
  audioClipsJson: string;
  /** opening 下部に表示するキャラ/ロゴ等を置くディレクトリ（ジョブ別 override 用） */
  openingIconsDir: string;
}

export function validateJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      `--job-id は英数字/ハイフン/アンダースコアのみ使えます（got: ${jobId}）`,
    );
  }
}

export function resolveRankingJobPaths(jobId: string): RankingJobPaths {
  validateJobId(jobId);
  const root = channelDataPath("scripts", jobId);
  return {
    jobId,
    root,
    scriptJson: path.join(root, "script.json"),
    nextStepsMd: path.join(root, "NEXT_STEPS.md"),
    planJson: path.join(root, "ranking-plan.json"),
    assetsDir: path.join(root, "assets"),
    narrationWav: path.join(root, "narration.wav"),
    scenePlanJson: path.join(root, "scene-plan.json"),
    wordsJson: path.join(root, "words.json"),
    ttsClipsDir: path.join(root, "tts-clips"),
    audioClipsJson: path.join(root, "audio-clips.json"),
    openingIconsDir: path.join(root, "assets", "opening-icons"),
  };
}

export function findAssetByBasename(dir: string, basename: string): string | null {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(dir, `${basename}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export interface RankingAssetResolution {
  itemImages: [string, string, string];
  backgroundImage: string;
  missing: string[];
}

export function resolveRankingAssets(
  assetsDir: string,
): RankingAssetResolution {
  const missing: string[] = [];
  const itemPaths: string[] = [];
  for (let rank = 1; rank <= 3; rank++) {
    const basename = `item-${rank}`;
    const p = findAssetByBasename(assetsDir, basename);
    if (p) {
      itemPaths.push(p);
    } else {
      missing.push(basename);
      itemPaths.push("");
    }
  }
  // background はジョブ別 override 専用。不在ならチャンネル既定（resolveBackgroundPath）に委ねる
  // ため missing には載せない（必須アセットではなくなった）。
  const bg = findAssetByBasename(assetsDir, "background");

  return {
    itemImages: [itemPaths[0]!, itemPaths[1]!, itemPaths[2]!],
    backgroundImage: bg ?? "",
    missing,
  };
}

export const IMAGE_EXTENSION_LIST = IMAGE_EXTENSIONS;
export const AUDIO_EXTENSION_LIST = AUDIO_EXTENSIONS;

export interface ResolvedBgm {
  /** 検出された BGM ファイルの絶対パス */
  path: string;
  /** どこから来たか（ログ表示用） */
  source: "cli-flag" | "job-override" | "channel-default";
}

/**
 * 利用可能な最初の音声ファイルを返す（ディレクトリ配下を AUDIO_EXTENSIONS 順で走査）。
 * 見つからなければ null。
 */
function findFirstAudio(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const ext of AUDIO_EXTENSIONS) {
    const hit = entries.find((name) => name.toLowerCase().endsWith(`.${ext}`));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

/**
 * 指定ディレクトリ配下の画像を IMAGE_EXTENSIONS 順 + ファイル名昇順で全て返す。
 * ディレクトリが無い場合は空配列。
 */
function listImagesSorted(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const isImage = (name: string): boolean =>
    IMAGE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(`.${ext}`));
  return entries
    .filter(isImage)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(dir, name));
}

export interface ResolvedOpeningIcons {
  /** 検出された画像の絶対パス（最大 3 枚で打ち切り）。0 件なら空配列 */
  paths: string[];
  source: "job-override" | "channel-default" | "none";
}

/**
 * opening 下部に表示するキャラ画像 / ロゴ等を解決する。優先順位:
 *   1. ジョブ assets/opening-icons/ 配下の画像（ジョブ別 override）
 *   2. packages/channels/<channel>/assets/opening-icons/ 配下の画像（チャンネル既定）
 *   3. なし
 *
 * 画像数は最大 3 枚で打ち切る（4 枚目以降は無視）。1〜3 枚で renderer がレイアウト調整する。
 */
export function resolveOpeningIcons(
  jobPaths: RankingJobPaths | null,
  channel: string,
): ResolvedOpeningIcons {
  const cap = (paths: string[]): string[] => paths.slice(0, 3);
  if (jobPaths) {
    const jobIcons = listImagesSorted(jobPaths.openingIconsDir);
    if (jobIcons.length > 0) {
      return { paths: cap(jobIcons), source: "job-override" };
    }
  }
  const channelIcons = listImagesSorted(channelAssetsDir("opening-icons", channel));
  if (channelIcons.length > 0) {
    return { paths: cap(channelIcons), source: "channel-default" };
  }
  return { paths: [], source: "none" };
}

export interface ResolvedBackground {
  /** 検出された背景画像の絶対パス */
  path: string;
  /** どこから来たか（ログ表示用） */
  source: "cli-flag" | "job-override" | "channel-default";
}

/**
 * 利用可能な最初の画像ファイルを返す（ディレクトリ配下を IMAGE_EXTENSIONS 順で走査）。
 * 見つからなければ null。
 */
function findFirstImage(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const ext of IMAGE_EXTENSIONS) {
    const hit = entries.find((name) => name.toLowerCase().endsWith(`.${ext}`));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

/**
 * 背景画像を解決する。優先順位:
 *   1. `cliBackgroundPath` (--background <path> 明示指定)
 *   2. ジョブ assets/background.{png|webp|jpg|jpeg}（このジョブだけ別背景したい時）
 *   3. `packages/channels/<channel>/assets/backgrounds/` 配下の最初の画像（チャンネル既定）
 *   4. null
 */
export function resolveBackgroundPath(
  jobPaths: RankingJobPaths | null,
  channel: string,
  cliBackgroundPath: string | null,
): ResolvedBackground | null {
  if (cliBackgroundPath) {
    return { path: cliBackgroundPath, source: "cli-flag" };
  }
  if (jobPaths) {
    const jobBg = findAssetByBasename(jobPaths.assetsDir, "background");
    if (jobBg) return { path: jobBg, source: "job-override" };
  }
  const channelBg = findFirstImage(channelAssetsDir("backgrounds", channel));
  if (channelBg) return { path: channelBg, source: "channel-default" };
  return null;
}

/**
 * BGM を解決する。優先順位:
 *   1. `cliBgmPath` (--bgm <path> 明示指定)
 *   2. ジョブ assets/bgm/ 配下の最初の音声ファイル（このジョブだけ別 BGM したい時）
 *   3. `packages/channels/<channel>/assets/bgm/` 配下の最初の音声ファイル（チャンネル既定）
 *   4. null
 */
export function resolveBgmPath(
  jobPaths: RankingJobPaths | null,
  channel: string,
  cliBgmPath: string | null,
): ResolvedBgm | null {
  if (cliBgmPath) {
    return { path: cliBgmPath, source: "cli-flag" };
  }
  if (jobPaths) {
    const jobBgm = findFirstAudio(path.join(jobPaths.assetsDir, "bgm"));
    if (jobBgm) return { path: jobBgm, source: "job-override" };
  }
  const channelBgm = findFirstAudio(channelAssetsDir("bgm", channel));
  if (channelBgm) return { path: channelBgm, source: "channel-default" };
  return null;
}
