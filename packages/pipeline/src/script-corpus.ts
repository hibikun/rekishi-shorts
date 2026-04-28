// script-corpus: バズショート動画の脚本を体系的に蓄積・分析するコーパス基盤
// add: yt-dlp で音声抽出 → Whisper で文字起こし → meta.json + script.md + 空 analysis.md を生成

import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import chalk from "chalk";
import { config } from "./config.js";

const CORPUS_ROOT = path.join(config.paths.repoRoot, "research", "script-corpus");
const VIDEOS_DIR = path.join(CORPUS_ROOT, "videos");
const INDEX_PATH = path.join(CORPUS_ROOT, "index.md");

export interface CorpusMeta {
  url: string;
  videoId: string;
  slug: string;
  channel: string;
  channelSlug: string;
  title: string;
  durationSeconds: number;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  uploadDate: string | null; // YYYYMMDD
  description: string;
  language: string;
  fetchedAt: string; // ISO
}

interface YtdlpMetadata {
  id: string;
  title: string;
  uploader: string;
  channel?: string;
  duration: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  upload_date?: string;
  description?: string;
  language?: string;
  webpage_url?: string;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  fullText: string;
  language: string;
}

/** kebab-case ASCIIスラッグに変換（日本語含む文字も transliteration なしで除去） */
function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unknown";
}

export function corpusPaths(slug: string) {
  const dir = path.join(VIDEOS_DIR, slug);
  return {
    dir,
    metaPath: path.join(dir, "meta.json"),
    transcriptPath: path.join(dir, "transcript.json"),
    scriptPath: path.join(dir, "script.md"),
    analysisPath: path.join(dir, "analysis.md"),
  };
}

export function listCorpusSlugs(): string[] {
  if (!fs.existsSync(VIDEOS_DIR)) return [];
  return fs
    .readdirSync(VIDEOS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** yt-dlp でメタ情報のみ取得（ダウンロードなし） */
function fetchMetadata(url: string): YtdlpMetadata {
  const stdout = execFileSync("yt-dlp", ["--dump-json", "--no-warnings", url], {
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** yt-dlp で音声を mp3 抽出。返り値はファイルパス */
function downloadAudio(url: string, destDir: string, videoId: string): string {
  const outPath = path.join(destDir, `${videoId}.mp3`);
  execFileSync(
    "yt-dlp",
    [
      "-f",
      "bestaudio",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "-o",
      outPath,
      "--no-warnings",
      url,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (!fs.existsSync(outPath)) {
    throw new Error(`yt-dlp did not produce expected file: ${outPath}`);
  }
  return outPath;
}

async function transcribeWithWhisper(audioPath: string, language: string): Promise<TranscriptResult> {
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: config.openai.whisperModel,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
    language,
  });
  const raw = response as unknown as {
    text?: string;
    language?: string;
    segments?: Array<{ text: string; start: number; end: number }>;
  };
  const segments: TranscriptSegment[] = (raw.segments ?? []).map((s) => ({
    text: s.text.trim(),
    start: s.start,
    end: s.end,
  }));
  return {
    segments,
    fullText: raw.text?.trim() ?? segments.map((s) => s.text).join(" "),
    language: raw.language ?? language,
  };
}

function renderScriptMarkdown(meta: CorpusMeta, transcript: TranscriptResult): string {
  const lines: string[] = [];
  lines.push(`# ${meta.title}`);
  lines.push("");
  lines.push(`- チャンネル: ${meta.channel}`);
  lines.push(`- URL: ${meta.url}`);
  lines.push(`- 尺: ${meta.durationSeconds}秒 / 言語: ${transcript.language}`);
  if (meta.viewCount !== null) lines.push(`- 再生数: ${meta.viewCount.toLocaleString()}`);
  if (meta.likeCount !== null) lines.push(`- いいね: ${meta.likeCount.toLocaleString()}`);
  lines.push("");
  lines.push("## 全文（タイムスタンプ付き）");
  lines.push("");
  for (const seg of transcript.segments) {
    const start = seg.start.toFixed(2).padStart(5, "0");
    const end = seg.end.toFixed(2).padStart(5, "0");
    lines.push(`- \`[${start}-${end}]\` ${seg.text}`);
  }
  lines.push("");
  lines.push("## プレーンテキスト");
  lines.push("");
  lines.push(transcript.fullText);
  lines.push("");
  return lines.join("\n");
}

function renderAnalysisTemplate(meta: CorpusMeta): string {
  return `---
slug: ${meta.slug}
video_id: ${meta.videoId}
analyzed_at: ${new Date().toISOString().slice(0, 10)}
status: empty
---

# 脚本分析: ${meta.title}

> \`status: empty\` のテンプレート。\`pnpm corpus analyze ${meta.slug}\` で Gemini が下書きを埋める。

## メタ
- チャンネル: ${meta.channel}
- 再生数: ${meta.viewCount?.toLocaleString() ?? "不明"}
- 尺: ${meta.durationSeconds}秒
- 言語: ${meta.language}
- URL: ${meta.url}

## Beat構造
（区間 / 役割 / 内容）

## フック技法
- 分類:
- なぜ効くか:

## 好奇心ギャップ
- 設置:
- 回収:

## リフレイン・キーフレーズ

## 文の長短リズム
- 平均語数/秒:
- 最短文:
- 最長文:

## クロージングの型
- 分類:
- 引用:

## rekishi に転用できる原則

## メモ（人による校正）
`;
}

function appendIndexRow(meta: CorpusMeta): void {
  const headerEnd = "|---|---|---|---|---|---|---|";
  const row = `| ${meta.slug} | ${meta.channel} | ${meta.title.replace(/\|/g, "\\|")} | ${meta.language} | ${meta.durationSeconds}s | ${meta.viewCount?.toLocaleString() ?? "-"} | (analyze 後に追記) |`;
  let content = fs.readFileSync(INDEX_PATH, "utf-8");
  if (content.includes(`| ${meta.slug} |`)) return; // 重複追記しない
  if (!content.includes(headerEnd)) {
    throw new Error(`index.md にヘッダ行が見つからない: ${INDEX_PATH}`);
  }
  // ヘッダ直下に挿入（新しいものを上に）
  content = content.replace(headerEnd, `${headerEnd}\n${row}`);
  fs.writeFileSync(INDEX_PATH, content);
}

export interface CorpusAddResult {
  meta: CorpusMeta;
  transcript: TranscriptResult;
  paths: ReturnType<typeof corpusPaths>;
}

export async function corpusAdd(url: string, opts: { language?: string } = {}): Promise<CorpusAddResult> {
  console.log(chalk.bold(`\n📥 corpus add: ${url}\n`));

  console.log(chalk.gray("  📋 メタ情報を取得中..."));
  const ytdlp = fetchMetadata(url);
  const channel = ytdlp.channel ?? ytdlp.uploader;
  const channelSlug = toSlug(channel);
  const slug = `${channelSlug}__${ytdlp.id}`;
  const language = opts.language ?? ytdlp.language ?? "en";

  const paths = corpusPaths(slug);
  fs.mkdirSync(paths.dir, { recursive: true });

  if (fs.existsSync(paths.transcriptPath)) {
    console.log(chalk.yellow(`  ⏭ 既に存在: ${slug}（再ダウンロード/再書き起こしはしない）`));
    const meta: CorpusMeta = JSON.parse(fs.readFileSync(paths.metaPath, "utf-8"));
    const transcript: TranscriptResult = JSON.parse(fs.readFileSync(paths.transcriptPath, "utf-8"));
    return { meta, transcript, paths };
  }

  // 音声を一時ディレクトリに落として、Whisper後に削除（mp3 は corpus に残さない方針）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `corpus-${ytdlp.id}-`));
  let audioPath: string;
  try {
    console.log(chalk.gray("  🎵 音声を抽出中..."));
    audioPath = downloadAudio(url, tmpDir, ytdlp.id);

    console.log(chalk.gray(`  🎙 Whisper で文字起こし中 (lang=${language})...`));
    const transcript = await transcribeWithWhisper(audioPath, language);

    const meta: CorpusMeta = {
      url: ytdlp.webpage_url ?? url,
      videoId: ytdlp.id,
      slug,
      channel,
      channelSlug,
      title: ytdlp.title,
      durationSeconds: ytdlp.duration,
      viewCount: ytdlp.view_count ?? null,
      likeCount: ytdlp.like_count ?? null,
      commentCount: ytdlp.comment_count ?? null,
      uploadDate: ytdlp.upload_date ?? null,
      description: ytdlp.description ?? "",
      language,
      fetchedAt: new Date().toISOString(),
    };

    fs.writeFileSync(paths.metaPath, JSON.stringify(meta, null, 2));
    fs.writeFileSync(paths.transcriptPath, JSON.stringify(transcript, null, 2));
    fs.writeFileSync(paths.scriptPath, renderScriptMarkdown(meta, transcript));
    if (!fs.existsSync(paths.analysisPath)) {
      fs.writeFileSync(paths.analysisPath, renderAnalysisTemplate(meta));
    }
    appendIndexRow(meta);

    console.log(chalk.green(`\n✅ ${slug} を追加`));
    console.log(chalk.dim(`   ${paths.dir}`));
    console.log(chalk.dim(`   segments=${transcript.segments.length} / lang=${transcript.language}`));
    console.log(chalk.bold("\n次のステップ:"));
    console.log(`  ${chalk.cyan(`pnpm --filter @rekishi/pipeline corpus analyze ${slug}`)}`);

    return { meta, transcript, paths };
  } finally {
    // 音声ファイルは保持しない方針
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
