#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import { RenderPlanSchema, type RenderPlan } from "@rekishi/shared";
import { dataPath } from "./config.js";
import { generateYouTubeMetadata } from "./metadata-generator.js";
import { metadataToDraftMd, draftMdToMetadata } from "./meta-draft-io.js";
import { uploadToYouTube, formatUploadError } from "./youtube/uploader.js";
import { runOAuthFlow } from "./youtube/oauth-flow.js";
import { appendUploadLog, hasBeenUploaded } from "./upload-log.js";
import { YouTubeMetadataSchema, type YouTubeMetadata } from "./index.js";

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
  .version("0.1.0");

program
  .command("auth")
  .description("YouTube OAuth 認可フローを起動し refresh_token を取得する（初回1回だけ）")
  .action(async () => {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI ?? "http://localhost:53682/oauth2callback";
    const scope = "https://www.googleapis.com/auth/youtube.upload";

    if (!clientId || !clientSecret) {
      console.error(chalk.red("❌ YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET が .env.local に未設定です。"));
      console.error("   docs/phases/youtube-setup.md を参照して OAuth クライアントを作成してください。");
      process.exit(1);
    }

    await runOAuthFlow({ clientId, clientSecret, redirectUri, scope });
  });

program
  .command("meta")
  .description("meta-draft.md を生成（人間レビュー用）")
  .argument("<jobId>", "ジョブID (data/scripts/<jobId>/)")
  .option("--regenerate", "既存 meta-draft.md があっても LLM で再生成する", false)
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

program.parseAsync().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
  process.exit(1);
});
