import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import type {
  ExportAssetCounts,
  ManabilabCanvaJob,
  ManabilabCanvaScene,
  ManabilabCanvaScript,
} from "@rekishi/shared";
import {
  channelRootDir,
  exportDir,
  exportManifestPath,
  exportManifestRelPath,
  exportZipPath,
  exportZipRelPath,
  jobDir,
  researchMdPath,
  scenesJsonPath,
  scriptJsonPath,
} from "./canva-job";

export interface CanvaExportSceneManifest {
  index: number;
  source: ManabilabCanvaScene["source"];
  caption: string;
  narration: string;
  selectedCandidateIndex?: number;
  image?: string;
  video?: string;
  audio?: string;
  audioDurationSec?: number;
}

export interface CanvaExportManifest {
  version: 1;
  jobId: string;
  generatedAt: string;
  topic: ManabilabCanvaJob["topic"];
  title: ManabilabCanvaScript["title"] | null;
  files: {
    research?: string;
    script?: string;
    scenes?: string;
    concatAudio?: string;
  };
  scenes: CanvaExportSceneManifest[];
  assetCounts: ExportAssetCounts;
  warnings: string[];
}

export interface CanvaExportPlan {
  manifest: CanvaExportManifest;
  requiredErrors: string[];
  warnings: string[];
  entries: Array<{ absPath: string; zipPath: string }>;
}

interface BuildPlanOptions {
  job: ManabilabCanvaJob;
  script: ManabilabCanvaScript | null;
  scenes: ManabilabCanvaScene[] | null;
  generatedAt: string;
  channelRoot: string;
  exists: (absPath: string) => Promise<boolean>;
}

interface CreateExportOptions {
  job: ManabilabCanvaJob;
  script: ManabilabCanvaScript | null;
  scenes: ManabilabCanvaScene[] | null;
}

interface CreateExportResult {
  manifest: CanvaExportManifest;
  zipPath: string;
  manifestPath: string;
}

function toZipPath(p: string): string {
  return p.split(path.sep).join("/");
}

function relToAbs(channelRoot: string, relPath: string): string {
  if (path.isAbsolute(relPath) || relPath.split(path.sep).includes("..")) {
    throw new Error(`invalid channel relative path: ${relPath}`);
  }
  return path.join(channelRoot, relPath);
}

async function defaultExists(absPath: string): Promise<boolean> {
  try {
    const s = await stat(absPath);
    return s.isFile();
  } catch {
    return false;
  }
}

export async function buildCanvaExportPlan({
  job,
  script,
  scenes,
  generatedAt,
  channelRoot,
  exists,
}: BuildPlanOptions): Promise<CanvaExportPlan> {
  const warnings: string[] = [];
  const requiredErrors: string[] = [];
  const entries: Array<{ absPath: string; zipPath: string }> = [];
  const assetCounts: ExportAssetCounts = {
    images: 0,
    videos: 0,
    sceneAudio: 0,
    concatAudio: 0,
  };

  async function addFile(
    relPath: string,
    zipPath: string,
    missingMessage: string,
    required: boolean,
  ): Promise<boolean> {
    let absPath: string;
    try {
      absPath = relToAbs(channelRoot, relPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (required) requiredErrors.push(msg);
      else warnings.push(msg);
      return false;
    }
    if (!(await exists(absPath))) {
      if (required) requiredErrors.push(missingMessage);
      else warnings.push(missingMessage);
      return false;
    }
    entries.push({ absPath, zipPath: toZipPath(zipPath) });
    return true;
  }

  await addFile(
    path.relative(channelRoot, researchMdPath(job.id)),
    "research.md",
    "research.md が見つかりません",
    false,
  );
  await addFile(
    path.relative(channelRoot, scriptJsonPath(job.id)),
    "script.json",
    "script.json が見つかりません",
    false,
  );
  await addFile(
    path.relative(channelRoot, scenesJsonPath(job.id)),
    "scenes.json",
    "scenes.json が見つかりません",
    !scenes || scenes.length === 0,
  );

  if (!scenes || scenes.length === 0) {
    requiredErrors.push("scenes.json にシーンがありません");
  }

  const sceneManifests: CanvaExportSceneManifest[] = [];
  for (const scene of scenes ?? []) {
    const sceneManifest: CanvaExportSceneManifest = {
      index: scene.index,
      source: scene.source,
      caption: scene.caption,
      narration: scene.narration,
      selectedCandidateIndex: scene.selectedCandidateIndex,
      audioDurationSec: scene.audioDurationSec,
    };
    const sceneNo = String(scene.index).padStart(2, "0");

    if (!scene.imagePath) {
      requiredErrors.push(`#${scene.index}: 画像候補が未選択です`);
    } else if (
      await addFile(
        scene.imagePath,
        `images/scene-${sceneNo}${path.extname(scene.imagePath) || ".png"}`,
        `#${scene.index}: 選択画像ファイルが見つかりません: ${scene.imagePath}`,
        true,
      )
    ) {
      sceneManifest.image = scene.imagePath;
      assetCounts.images += 1;
    }

    if (scene.videoPath) {
      if (
        await addFile(
          scene.videoPath,
          `videos/scene-${sceneNo}${path.extname(scene.videoPath) || ".mp4"}`,
          `#${scene.index}: 動画ファイルが見つかりません: ${scene.videoPath}`,
          false,
        )
      ) {
        sceneManifest.video = scene.videoPath;
        assetCounts.videos += 1;
      }
    } else {
      warnings.push(`#${scene.index}: 動画は未生成です`);
    }

    if (scene.audioPath) {
      if (
        await addFile(
          scene.audioPath,
          `audio/scene-${sceneNo}${path.extname(scene.audioPath) || ".wav"}`,
          `#${scene.index}: 音声ファイルが見つかりません: ${scene.audioPath}`,
          false,
        )
      ) {
        sceneManifest.audio = scene.audioPath;
        assetCounts.sceneAudio += 1;
      }
    } else {
      warnings.push(`#${scene.index}: 音声は未生成です`);
    }

    sceneManifests.push(sceneManifest);
  }

  const concatAudioPath = job.steps.tts.concatAudioPath;
  if (concatAudioPath) {
    if (
      await addFile(
        concatAudioPath,
        `audio/full${path.extname(concatAudioPath) || ".wav"}`,
        `結合音声ファイルが見つかりません: ${concatAudioPath}`,
        false,
      )
    ) {
      assetCounts.concatAudio = 1;
    }
  } else {
    warnings.push("結合音声 full.wav は未生成です");
  }

  const manifest: CanvaExportManifest = {
    version: 1,
    jobId: job.id,
    generatedAt,
    topic: job.topic,
    title: script?.title ?? null,
    files: {
      research: "research.md",
      script: "script.json",
      scenes: "scenes.json",
      concatAudio: assetCounts.concatAudio > 0 ? concatAudioPath : undefined,
    },
    scenes: sceneManifests,
    assetCounts,
    warnings,
  };

  return { manifest, requiredErrors, warnings, entries };
}

export async function createCanvaExport({
  job,
  script,
  scenes,
}: CreateExportOptions): Promise<CreateExportResult> {
  const generatedAt = new Date().toISOString();
  const plan = await buildCanvaExportPlan({
    job,
    script,
    scenes,
    generatedAt,
    channelRoot: channelRootDir(),
    exists: defaultExists,
  });

  if (plan.requiredErrors.length > 0) {
    throw new Error(plan.requiredErrors.join(" / "));
  }

  const outDir = exportDir(job.id);
  await mkdir(outDir, { recursive: true });
  const manifestAbs = exportManifestPath(job.id);
  const zipAbs = exportZipPath(job.id);

  await writeFile(manifestAbs, `${JSON.stringify(plan.manifest, null, 2)}\n`, "utf-8");

  const zipEntries = [
    ...plan.entries,
    { absPath: manifestAbs, zipPath: "manifest.json" },
  ];
  await writeZip(zipAbs, zipEntries);

  return {
    manifest: plan.manifest,
    zipPath: exportZipRelPath(job.id),
    manifestPath: exportManifestRelPath(job.id),
  };
}

async function writeZip(
  destPath: string,
  entries: Array<{ absPath: string; zipPath: string }>,
): Promise<void> {
  const zipEntries: ZipEntry[] = [];
  for (const entry of entries) {
    zipEntries.push({
      name: entry.zipPath,
      data: await readFile(entry.absPath),
    });
  }
  await writeFile(destPath, createZipBuffer(zipEntries));
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date:
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

export function createZipBuffer(entries: ZipEntry[]): Buffer {
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const { time, date } = dosDateTime();
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    fileParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, central, end]);
}
