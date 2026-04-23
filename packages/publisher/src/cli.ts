#!/usr/bin/env node
import { Command, Option } from "commander";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import { RenderPlanSchema, type RenderPlan } from "@rekishi/shared";
import { DEFAULT_CHANNEL, channelDocsDir, setChannel } from "@rekishi/shared/channel";
import { dataPath } from "./config.js";

function channelOption(): Option {
  return new Option("--channel <id>", "チャンネルID (rekishi | kosei ...)").default(DEFAULT_CHANNEL);
}
import { generateYouTubeMetadata } from "./metadata-generator.js";
import { metadataToDraftMd, draftMdToMetadata } from "./meta-draft-io.js";
import { uploadToYouTube, formatUploadError } from "./youtube/uploader.js";
import { runOAuthFlow } from "./youtube/oauth-flow.js";
import { appendUploadLog, hasBeenUploaded, readAllUploads } from "./upload-log.js";
import { YouTubeMetadataSchema, type YouTubeMetadata } from "./index.js";
import { fetchStatsForVideos } from "./analytics/fetch-stats.js";
import { appendSnapshots } from "./analytics/store.js";
import { buildSummary, renderSummaryTable, type SortKey } from "./analytics/summary.js";
import { runResearch } from "./research/youtube-research.js";
import { renderMarkdownReport } from "./research/report.js";

function log(msg: string): void {
  console.log(msg);
}

function buildVideoFilename(title: string, jobId: string): string {
  const safe = title.replace(/[\/\\:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  return safe ? `${safe}-${jobId}.mp4` : `${jobId}.mp4`;
}

async function loadRenderPlan(jobId: string): Promise<RenderPlan> {
  const p = dataPath("scripts", jobId, "render-plan.json");
  const raw = await fs.readFile(p, "utf-8");
  return RenderPlanSchema.parse(JSON.parse(raw));
}

async function resolveVideoPath(plan: RenderPlan): Promise<string> {
  const candidate = path.join(dataPath("videos"), buildVideoFilename(plan.script.topic.title, plan.id));
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    // フォールバック: data/videos 内の *-<jobId>.mp4 を探す
    const dir = dataPath("videos");
    const files = await fs.readdir(dir);
    const match = files.find((f) => f.endsWith(`-${plan.id}.mp4`) || f === `${plan.id}.mp4`);
    if (match) return path.join(dir, match);
    throw new Error(`動画ファイルが見つかりません: ${candidate}\n   data/videos/ 内を確認してください。`);
  }
}

async function loadOrBuildMetaDraft(plan: RenderPlan, opts: { regenerate: boolean }): Promise<{ metadata: YouTubeMetadata; draftPath: string }> {
  const draftPath = path.join(dataPath("scripts", plan.id), "meta-draft.md");
  const metaJsonPath = path.join(dataPath("scripts", plan.id), "meta.json");

  if (!opts.regenerate) {
    try {
      await fs.access(draftPath);
      const original = await readMetaJson(metaJsonPath);
      const md = await fs.readFile(draftPath, "utf-8");
      const metadata = draftMdToMetadata(md, original);
      return { metadata, draftPath };
    } catch {
      // fall through to generation
    }
  }

  log(chalk.dim("Gemini でメタデータ生成中..."));
  const { metadata, usage } = await generateYouTubeMetadata(plan);
  log(chalk.dim(`   model=${usage.model} in=${usage.inputTokens}tok out=${usage.outputTokens}tok`));

  await fs.mkdir(path.dirname(draftPath), { recursive: true });
  await fs.writeFile(metaJsonPath, JSON.stringify(metadata, null, 2), "utf-8");
  await fs.writeFile(draftPath, metadataToDraftMd(metadata, { jobId: plan.id }), "utf-8");
  return { metadata, draftPath };
}

async function readMetaJson(p: string): Promise<YouTubeMetadata> {
  const raw = await fs.readFile(p, "utf-8");
  return YouTubeMetadataSchema.parse(JSON.parse(raw));
}

const program = new Command();

program
  .name("rekishi-publisher")
  .description("生成済みショート動画を YouTube 等へ投稿する CLI")
  .version("0.1.0")
  .hook("preAction", (_thisCommand, actionCommand) => {
    const ch = actionCommand.opts().channel as string | undefined;
    if (ch) setChannel(ch);
  });

program
  .command("auth")
  .description("YouTube OAuth 認可フローを起動し refresh_token を取得する（初回 / スコープ追加時）")
  .addOption(channelOption())
  .action(async () => {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI ?? "http://localhost:53682/oauth2callback";
    const scopes = [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ];

    if (!clientId || !clientSecret) {
      console.error(chalk.red("❌ YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET が .env.local に未設定です。"));
      console.error("   docs/phases/youtube-setup.md を参照して OAuth クライアントを作成してください。");
      process.exit(1);
    }

    await runOAuthFlow({ clientId, clientSecret, redirectUri, scopes });
  });

program
  .command("meta")
  .description("meta-draft.md を生成（人間レビュー用）")
  .argument("<jobId>", "ジョブID (data/<channel>/scripts/<jobId>/)")
  .option("--regenerate", "既存 meta-draft.md があっても LLM で再生成する", false)
  .addOption(channelOption())
  .action(async (jobId, opts) => {
    log(chalk.bold(`\n📝 meta-draft 生成: ${jobId}\n`));
    const plan = await loadRenderPlan(jobId);
    const { draftPath } = await loadOrBuildMetaDraft(plan, { regenerate: opts.regenerate });
    log(chalk.green(`✅ 保存: ${draftPath}`));
    log(chalk.bold("\n次のステップ:"));
    log(`  1. ${chalk.cyan(draftPath)} を開いて title / description / tags / privacy を編集`);
    log(`  2. ${chalk.cyan(`pnpm post youtube ${jobId}`)} で投稿`);
  });

program
  .command("youtube")
  .description("meta-draft.md を読み込んで YouTube にアップロード")
  .argument("<jobId>", "ジョブID")
  .option("--privacy <status>", "公開状態 (public | unlisted | private)")
  .option("--force", "同一 jobId の投稿履歴があっても続行", false)
  .option("--dry-run", "送信せずペイロードだけ表示", false)
  .addOption(channelOption())
  .action(async (jobId, opts) => {
    log(chalk.bold(`\n🚀 YouTube upload: ${jobId}\n`));

    const existing = await hasBeenUploaded(jobId);
    if (existing && !opts.force) {
      log(chalk.yellow(`⚠ 既に投稿済みです: ${existing.url} (${existing.uploadedAt})`));
      log(chalk.yellow(`   再投稿するなら --force を付けてください。`));
      process.exit(1);
    }

    const plan = await loadRenderPlan(jobId);
    const { metadata } = await loadOrBuildMetaDraft(plan, { regenerate: false });

    const finalMetadata: YouTubeMetadata = opts.privacy
      ? YouTubeMetadataSchema.parse({ ...metadata, privacyStatus: opts.privacy })
      : metadata;

    const videoPath = await resolveVideoPath(plan);
    log(chalk.dim(`   video: ${videoPath}`));
    log(chalk.dim(`   title: ${finalMetadata.title}`));
    log(chalk.dim(`   privacy: ${finalMetadata.privacyStatus}`));
    log(chalk.dim(`   tags: ${finalMetadata.tags.length} 個 (${finalMetadata.tags.join(", ")})`));

    if (opts.dryRun) {
      log(chalk.yellow("\n--dry-run 指定。送信しません。"));
      console.log(JSON.stringify(finalMetadata, null, 2));
      return;
    }

    try {
      const result = await uploadToYouTube({ videoPath, metadata: finalMetadata });
      await appendUploadLog({
        jobId: plan.id,
        videoId: result.videoId,
        url: result.url,
        uploadedAt: result.uploadedAt,
        privacy: finalMetadata.privacyStatus,
        title: finalMetadata.title,
      });
      const uploadJsonPath = path.join(dataPath("scripts", plan.id), "upload.json");
      await fs.writeFile(
        uploadJsonPath,
        JSON.stringify({ ...result, privacy: finalMetadata.privacyStatus, title: finalMetadata.title }, null, 2),
        "utf-8",
      );
      log(chalk.green(`\n✅ 完了: ${result.url}`));
    } catch (err) {
      log(chalk.red("\n❌ アップロード失敗"));
      log(chalk.red(`   ${formatUploadError(err)}`));
      process.exit(1);
    }
  });

program
  .command("stats")
  .description("アップロード済み動画の実績データ（統計＋分析指標）を取得して JSONL に追記")
  .option("--only <jobId>", "特定の jobId だけ取得")
  .option("--dry-run", "取得結果を表示するだけで保存しない", false)
  .addOption(channelOption())
  .action(async (opts) => {
    log(chalk.bold("\n📊 YouTube stats 取得\n"));

    const allUploads = await readAllUploads();
    let targets = allUploads;
    if (opts.only) {
      targets = targets.filter((u) => u.jobId === opts.only);
      if (targets.length === 0) {
        log(chalk.yellow(`⚠ jobId=${opts.only} に該当する投稿が log.jsonl にありません`));
        process.exit(1);
      }
    }

    if (targets.length === 0) {
      log(chalk.yellow("⚠ 対象の動画がありません。"));
      return;
    }

    log(chalk.dim(`   対象: ${targets.length} 本`));
    for (const t of targets) {
      log(chalk.dim(`   - ${t.videoId} ${t.privacy.padEnd(8)} ${t.title}`));
    }

    const snapshots = await fetchStatsForVideos(targets);

    log("");
    for (const s of snapshots) {
      const ageDays = (s.ageHours / 24).toFixed(1);
      const a = s.analytics;
      const base = `${chalk.bold(s.videoId)} (${ageDays}d)  views=${s.statistics.viewCount}  👍${s.statistics.likeCount}  💬${s.statistics.commentCount}`;
      if (a) {
        log(`${base}  視聴率=${a.averageViewPercentage.toFixed(1)}%  平均=${a.averageViewDuration.toFixed(1)}s  登録+${a.subscribersGained}/-${a.subscribersLost}  shares=${a.shares}`);
      } else {
        log(`${base}  ${chalk.red(`analytics取得失敗: ${s.analyticsError ?? "unknown"}`)}`);
      }
    }

    if (opts.dryRun) {
      log(chalk.yellow("\n--dry-run 指定。保存しません。"));
      return;
    }

    const file = await appendSnapshots(snapshots);
    log(chalk.green(`\n✅ ${snapshots.length} 件のスナップショットを追記: ${file}`));
  });

function parseMinAge(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /^(\d+(?:\.\d+)?)([hd]?)$/.exec(raw.trim());
  if (!m || !m[1]) throw new Error(`--min-age の書式が不正です: "${raw}" (例: 24h, 2d)`);
  const n = parseFloat(m[1]);
  return m[2] === "d" ? n * 24 : n;
}

const SORT_KEYS: SortKey[] = ["views", "likeRate", "retention", "subs", "age"];

program
  .command("summary")
  .description("snapshots.jsonl から動画別KPIサマリをターミナルに表示")
  .option("--sort <key>", `並び順 (${SORT_KEYS.join("|")})`, "views")
  .option("--min-age <duration>", "経過時間の下限で絞り込み（例: 24h, 2d）")
  .addOption(channelOption())
  .action((opts) => {
    const sort = opts.sort as SortKey;
    if (!SORT_KEYS.includes(sort)) {
      console.error(chalk.red(`❌ --sort は ${SORT_KEYS.join("|")} のいずれかです。受け取った値: ${sort}`));
      process.exit(1);
    }
    const minAgeHours = parseMinAge(opts.minAge);
    return buildSummary({ sort, minAgeHours }).then((rows) => {
      log("");
      log(renderSummaryTable(rows));
      log("");
    });
  });

const DEFAULT_RESEARCH_QUERIES = [
  "日本史 shorts",
  "世界史 shorts",
  "歴史 ショート",
  "戦国武将 shorts",
  "幕末 shorts",
  "偉人 歴史 shorts",
  "日本史 受験 shorts",
  "歴史 解説 shorts",
  "古代史 shorts",
  "世界史 偉人 shorts",
];

program
  .command("research")
  .description("競合の YouTube Shorts を調査しMarkdownレポートを生成")
  .option("-q, --queries <list>", "検索クエリ（カンマ区切り）。未指定時はデフォルトセットを使用")
  .option("--channels <n>", "深掘りするチャンネル数", "12")
  .option("--candidates <n>", "検索から拾うチャンネル候補の上限", "80")
  .option("--uploads <n>", "各チャンネルから取得する直近アップロード数", "50")
  .option("--window <days>", "集計対象とする日数（投稿日起算）", "90")
  .option("--max-duration <sec>", "Shorts と見なす最大秒数", "75")
  .option("--out <path>", "レポート出力先（Markdown）", "")
  .addOption(channelOption())
  .action(async (opts) => {
    log(chalk.bold("\n🕵️  競合Shortsリサーチ\n"));

    const queries = opts.queries
      ? String(opts.queries).split(",").map((s: string) => s.trim()).filter(Boolean)
      : DEFAULT_RESEARCH_QUERIES;

    const topChannels = parseInt(opts.channels, 10);
    const candidateLimit = parseInt(opts.candidates, 10);
    const recentUploadsPerChannel = parseInt(opts.uploads, 10);
    const windowDays = parseInt(opts.window, 10);
    const shortsMaxDurationSec = parseInt(opts.maxDuration, 10);

    const result = await runResearch({
      queries,
      channelCandidateLimit: candidateLimit,
      topChannels,
      recentUploadsPerChannel,
      shortsMaxDurationSec,
      windowDays,
      onLog: (m) => console.error(chalk.dim(m)),
    });

    const today = result.generatedAt.slice(0, 10);
    const defaultOut = path.join(channelDocsDir(), `competitor-report-${today}.md`);
    const outMd = opts.out ? path.resolve(String(opts.out)) : defaultOut;
    const outJson = outMd.replace(/\.md$/, ".json");

    const md = renderMarkdownReport(result, { windowDays });
    await fs.mkdir(path.dirname(outMd), { recursive: true });
    await fs.writeFile(outMd, md, "utf-8");
    await fs.writeFile(outJson, JSON.stringify(result, null, 2), "utf-8");

    log("");
    log(chalk.green(`✅ Markdown: ${outMd}`));
    log(chalk.green(`✅ JSON    : ${outJson}`));
    log(chalk.dim(`   分析 ${result.channelsAnalyzed.length}ch / ${result.shorts.length}本 / quota ${result.quotaEstimate}units`));
  });

program.parseAsync().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
  process.exit(1);
});
