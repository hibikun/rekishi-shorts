#!/usr/bin/env node
import { Command, Option } from "commander";
import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { RankingPlanSchema, TopicSchema } from "@rekishi/shared";
import { DEFAULT_CHANNEL, setChannel } from "@rekishi/shared/channel";
import {
  generatePlan,
  getJobOutputDir,
  runBuildStage,
  runDraftStage,
  runRealignStage,
  runResearchStage,
} from "./orchestrator.js";

function channelOption(): Option {
  return new Option("--channel <id>", "チャンネルID (rekishi | kosei ...)").default(DEFAULT_CHANNEL);
}

function buildOutputFilename(title: string, jobId: string): string {
  const safe = title.replace(/[\/\\:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  return safe ? `${safe}-${jobId}.mp4` : `${jobId}.mp4`;
}

const program = new Command();

program
  .name("rekishi-shorts")
  .description("受験生向け歴史ショート動画の自動生成 CLI")
  .version("0.1.0")
  .hook("preAction", (_thisCommand, actionCommand) => {
    const ch = actionCommand.opts().channel as string | undefined;
    if (ch) setChannel(ch);
  });

program
  .command("research")
  .description("Gemini + Google Search でトピックのリサーチ資料（research.md）を生成。draft の前段")
  .requiredOption("--topic <title>", "トピック名（例: 生類憐みの令）")
  .option("--era <era>", "時代（例: 江戸）")
  .option("--subject <subject>", "科目（日本史 | 世界史）", "日本史")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--format <format>", "台本フォーマット（single | three-pick）", "single")
  .addOption(channelOption())
  .action(async (opts) => {
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject,
      target: opts.target,
      format: opts.format,
    });
    console.log(chalk.bold(`\n🔎 rekishi-shorts research: ${topic.title}\n`));

    const { jobId, researchPath, tracker, sourceCount, queryCount } = await runResearchStage(topic);
    console.log(chalk.green(`\n✅ research 保存: ${researchPath}`));
    console.log(chalk.dim(`   jobId=${jobId} / sources=${sourceCount} / queries=${queryCount}`));
    console.log(chalk.bold("\n次のステップ:"));
    console.log(`  1. ${chalk.cyan(researchPath)} を開いて内容確認（必要なら編集）`);
    console.log(`  2. ${chalk.cyan(`pnpm draft --job ${jobId} --topic "${topic.title}"${topic.era ? ` --era "${topic.era}"` : ""}`)} で台本生成`);
    console.log(chalk.bold("\n💰 research 段階のコスト:"));
    console.log(tracker.formatTable());
  });

program
  .command("draft")
  .description("台本のみ生成して draft.md を出力（人間レビュー用）")
  .requiredOption("--topic <title>", "トピック名（例: ペリー来航）")
  .option("--era <era>", "時代（例: 幕末）")
  .option("--subject <subject>", "科目（日本史 | 世界史）", "日本史")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--format <format>", "台本フォーマット（single | three-pick）", "single")
  .option("--job <jobId>", "既存の research ジョブを引き継ぐ（research.md をプロンプトに注入）")
  .addOption(channelOption())
  .action(async (opts) => {
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject,
      target: opts.target,
      format: opts.format,
    });
    console.log(chalk.bold(`\n🎞️  rekishi-shorts draft: ${topic.title}${opts.job ? ` (job=${opts.job})` : ""}\n`));

    const { jobId, draftPath, tracker } = await runDraftStage(topic, opts.job);
    console.log(chalk.green(`\n✅ draft 保存: ${draftPath}`));
    console.log(chalk.bold("\n次のステップ:"));
    console.log(`  1. ${chalk.cyan(draftPath)} を開いて narration / keyTerms / readings / mnemonic を編集`);
    console.log(`  2. 編集 OK になったら ${chalk.cyan(`pnpm build ${jobId}`)} を実行`);
    console.log(chalk.bold("\n💰 draft 段階のコスト:"));
    console.log(tracker.formatTable());
  });

program
  .command("build")
  .description("draft.md を読み込んでシーン分割〜レンダリングまで実行")
  .argument("<jobId>", "draft で生成したジョブID")
  .option("--no-generate-images", "Nano Banana 画像生成をスキップし Wikimedia のみ")
  .option("--plan-only", "RenderPlan 生成まで（レンダリングしない）")
  .addOption(channelOption())
  .action(async (jobId, opts) => {
    console.log(chalk.bold(`\n🎞️  rekishi-shorts build: ${jobId}\n`));

    const { plan, tracker } = await runBuildStage({
      jobId,
      allowImageGeneration: opts.generateImages !== false,
    });

    if (opts.planOnly) {
      console.log(chalk.yellow("\n--plan-only 指定のためレンダリングをスキップします"));
      console.log(chalk.bold("\n💰 コスト内訳:"));
      console.log(tracker.formatTable());
      return;
    }

    const { renderHistoryShort } = await import("@rekishi/renderer");
    const outputPath = path.join(getJobOutputDir(), buildOutputFilename(plan.script.topic.title, plan.id));
    console.log(chalk.bold(`\n🎥 Remotion でレンダリング中...`));
    await renderHistoryShort(plan, outputPath);
    console.log(chalk.green(`\n✅ 完成: ${outputPath}`));
    console.log(chalk.bold("\n💰 コスト内訳:"));
    console.log(tracker.formatTable());
  });

program
  .command("generate")
  .description("台本生成からレンダリングまで一気通貫で実行（レビューなし）")
  .requiredOption("--topic <title>", "トピック名（例: ペリー来航）")
  .option("--era <era>", "時代（例: 幕末）")
  .option("--subject <subject>", "科目（日本史 | 世界史）", "日本史")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--format <format>", "台本フォーマット（single | three-pick）", "single")
  .option("--no-generate-images", "Nano Banana 画像生成をスキップし Wikimedia のみ")
  .option("--plan-only", "RenderPlan 生成まで（レンダリングしない）")
  .addOption(channelOption())
  .action(async (opts) => {
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject,
      target: opts.target,
      format: opts.format,
    });
    console.log(chalk.bold(`\n🎞️  rekishi-shorts: ${topic.title}\n`));

    const { plan, tracker } = await generatePlan({
      topic,
      allowImageGeneration: opts.generateImages !== false,
    });

    if (opts.planOnly) {
      console.log(chalk.yellow("\n--plan-only 指定のためレンダリングをスキップします"));
      console.log(chalk.bold("\n💰 コスト内訳:"));
      console.log(tracker.formatTable());
      return;
    }

    const { renderHistoryShort } = await import("@rekishi/renderer");
    const outputPath = path.join(getJobOutputDir(), buildOutputFilename(plan.script.topic.title, plan.id));
    console.log(chalk.bold(`\n🎥 Remotion でレンダリング中...`));
    await renderHistoryShort(plan, outputPath);
    console.log(chalk.green(`\n✅ 完成: ${outputPath}`));
    console.log(chalk.bold("\n💰 コスト内訳:"));
    console.log(tracker.formatTable());
  });

program
  .command("realign")
  .description("既存の narration.wav を使って ASR+シーン整列+レンダリングのみ再実行（TTS/画像は再利用）")
  .argument("<jobId>", "既存のジョブID")
  .option("--fresh-asr", "既存 words.json があっても Whisper を再実行する", false)
  .option("--no-vad", "VAD フォールバックを無効化（線形配分＝main 相当の挙動を再現）")
  .option("--suffix <name>", "出力ファイル名にサフィックスを付与（比較用に並列保存）", "")
  .option("--no-render", "Remotion レンダリングをスキップして render-plan.json だけ更新")
  .addOption(channelOption())
  .action(async (jobId, opts) => {
    console.log(chalk.bold(`\n🔁 rekishi-shorts realign: ${jobId}${opts.suffix ? ` [${opts.suffix}]` : ""}\n`));

    const { plan, tracker } = await runRealignStage({
      jobId,
      freshAsr: opts.freshAsr,
      disableVad: opts.vad === false,
      planSuffix: opts.suffix || undefined,
    });

    if (opts.render === false) {
      console.log(chalk.yellow("\n--no-render 指定のためレンダリングをスキップします"));
      console.log(chalk.bold("\n💰 コスト内訳:"));
      console.log(tracker.formatTable());
      return;
    }

    const { renderHistoryShort } = await import("@rekishi/renderer");
    const baseName = buildOutputFilename(plan.script.topic.title, plan.id);
    const finalName = opts.suffix
      ? baseName.replace(/(\.mp4)$/i, `-${opts.suffix}$1`)
      : baseName;
    const outputPath = path.join(getJobOutputDir(), finalName);
    console.log(chalk.bold(`\n🎥 Remotion でレンダリング中...`));
    await renderHistoryShort(plan, outputPath);
    console.log(chalk.green(`\n✅ 完成: ${outputPath}`));
    console.log(chalk.bold("\n💰 コスト内訳:"));
    console.log(tracker.formatTable());
  });

program
  .command("render")
  .description("既存の render-plan.json を使ってレンダリングのみ実行（再費用なし）")
  .requiredOption("--plan-id <id>", "ジョブID（data/<channel>/scripts/<id>/ 配下）")
  .addOption(channelOption())
  .action(async (opts) => {
    const { default: fs } = await import("node:fs");
    const { RenderPlanSchema } = await import("@rekishi/shared");
    const { dataPath } = await import("./config.js");
    const planPath = path.join(dataPath("scripts", opts.planId), "render-plan.json");
    const raw = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    const plan = RenderPlanSchema.parse(raw);
    const { renderHistoryShort } = await import("@rekishi/renderer");
    const outputPath = path.join(getJobOutputDir(), buildOutputFilename(plan.script.topic.title, plan.id));
    console.log(chalk.bold(`🎥 Remotion でレンダリング中: ${plan.id}`));
    await renderHistoryShort(plan, outputPath);
    console.log(chalk.green(`\n✅ 完成: ${outputPath}`));
  });

program
  .command("script-only")
  .description("台本生成のみ実行（API試運転用）")
  .requiredOption("--topic <title>")
  .option("--era <era>")
  .option("--subject <subject>", "", "日本史")
  .option("--target <target>", "", "汎用")
  .option("--format <format>", "", "single")
  .option("--out <path>", "script.json の書き出し先。省略時は stdout")
  .option(
    "--job-id <id>",
    "ジョブID。指定すると data/<channel>/scripts/<id>/script.json に保存し NEXT_STEPS.md も出力",
  )
  .addOption(channelOption())
  .action(async (opts) => {
    const { generateScript } = await import("./script-generator.js");
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject,
      target: opts.target,
      format: opts.format,
    });
    const { script } = await generateScript(topic);
    const json = JSON.stringify(script, null, 2);

    if (opts.jobId) {
      const { resolveRankingJobPaths } = await import("./ranking-paths.js");
      const paths = resolveRankingJobPaths(opts.jobId);
      fs.mkdirSync(paths.root, { recursive: true });
      fs.mkdirSync(paths.assetsDir, { recursive: true });
      fs.writeFileSync(paths.scriptJson, json);
      console.log(chalk.green(`✅ script 保存: ${paths.scriptJson}`));

      if (topic.format === "three-pick" && opts.channel === "ranking") {
        const { buildNextStepsMarkdown, buildStdoutGuideLines } = await import(
          "./ranking-next-steps.js"
        );
        const assetsDirRelative = path.relative(
          process.cwd(),
          paths.assetsDir,
        );
        const md = buildNextStepsMarkdown({
          script,
          jobId: opts.jobId,
          channel: opts.channel,
          assetsDirRelative,
        });
        fs.writeFileSync(paths.nextStepsMd, md);
        console.log(chalk.green(`📝 NEXT_STEPS 保存: ${paths.nextStepsMd}`));
        console.log();
        console.log(chalk.bold("次の手順:"));
        for (const line of buildStdoutGuideLines({
          script,
          jobId: opts.jobId,
          channel: opts.channel,
          assetsDirAbsolute: paths.assetsDir,
          nextStepsPath: paths.nextStepsMd,
        })) {
          console.log(line);
        }
      }
      return;
    }

    if (opts.out) {
      fs.mkdirSync(path.dirname(opts.out), { recursive: true });
      fs.writeFileSync(opts.out, json);
      console.log(chalk.green(`✅ script 保存: ${opts.out}`));
    } else {
      console.log(json);
    }
  });

program
  .command("build-ranking-plan")
  .description(
    "script.json と手動アセットから ranking-plan.json を組み立てる（Step B 手動フロー用）",
  )
  .option("--job-id <id>", "ジョブID。指定すると script.json と assets/ を conventional パスから解決")
  .option("--script <path>", "script-only で生成した script.json（--job-id 指定時は省略可）")
  .option("--background <path>", "ブラー背景画像（--job-id 指定時は省略可）")
  .option(
    "--images <csv>",
    "商品画像 3枚のパスをカンマ区切りで rank1,rank2,rank3 の順に指定（--job-id 指定時は省略可）",
  )
  .option("--narration <path>", "ナレーション音声（mp3/wav）")
  .option("--bgm <path>", "BGM（mp3）")
  .option("--rank-sfx <path>", "ランク登場SFX")
  .option("--hook-sfx <path>", "オープニング冒頭SFX")
  .option("--id <string>", "ranking-plan.id。省略時は ranking-<timestamp> or jobId")
  .option("--out <path>", "ranking-plan.json の書き出し先")
  .addOption(channelOption())
  .action(async (opts) => {
    const { buildRankingPlan, readScriptFile, writeRankingPlan } = await import(
      "./ranking-plan-builder.js"
    );

    let scriptPath: string | undefined = opts.script;
    let backgroundPath: string | undefined = opts.background;
    let imagePaths: [string, string, string] | undefined;
    let outPath: string | undefined = opts.out;
    let planId: string | undefined = opts.id;

    if (opts.jobId) {
      const { resolveRankingJobPaths, resolveRankingAssets } = await import(
        "./ranking-paths.js"
      );
      const paths = resolveRankingJobPaths(opts.jobId);
      scriptPath = scriptPath ?? paths.scriptJson;
      outPath = outPath ?? paths.planJson;
      planId = planId ?? opts.jobId;

      if (!opts.background || !opts.images) {
        if (!fs.existsSync(paths.assetsDir)) {
          throw new Error(
            `アセットディレクトリが見当たりません: ${paths.assetsDir}\n` +
              `先に script-only --job-id ${opts.jobId} を実行し、画像を配置してください。`,
          );
        }
        const { itemImages, backgroundImage, missing } = resolveRankingAssets(
          paths.assetsDir,
        );
        if (missing.length > 0) {
          const script = fs.existsSync(paths.scriptJson)
            ? readScriptFile(paths.scriptJson)
            : null;
          const items = script?.items ?? [];
          console.error(chalk.red(`\n❌ 画像ファイルが見つかりません:`));
          for (const name of missing) {
            const m = name.match(/^item-(\d)$/);
            const rank = m ? Number(m[1]) : null;
            const it = rank ? items.find((x) => x.rank === rank) : null;
            const ref = it?.officialUrl || it?.affiliateUrl || it?.searchKeywords;
            console.error(
              chalk.red(`  - ${name}.(png|webp|jpg|jpeg) が ${paths.assetsDir}/ に不在`),
            );
            if (it?.name) console.error(chalk.dim(`      商品: ${it.name}`));
            if (ref) console.error(chalk.dim(`      参考: ${ref}`));
          }
          console.error(chalk.yellow(`\n→ NEXT_STEPS.md を参照: ${paths.nextStepsMd}`));
          process.exit(1);
        }
        imagePaths = itemImages;
        backgroundPath = backgroundPath ?? backgroundImage;
      }
    }

    if (!scriptPath) throw new Error("--script または --job-id のいずれかが必要です");
    if (!backgroundPath) throw new Error("--background または --job-id のいずれかが必要です");

    if (!imagePaths) {
      if (!opts.images) throw new Error("--images または --job-id のいずれかが必要です");
      const parsed = (opts.images as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parsed.length !== 3) {
        throw new Error(
          `--images は rank1,rank2,rank3 の順で 3件必要です（got ${parsed.length}）`,
        );
      }
      imagePaths = [
        path.resolve(parsed[0]!),
        path.resolve(parsed[1]!),
        path.resolve(parsed[2]!),
      ];
    }

    const script = readScriptFile(scriptPath);
    const plan = buildRankingPlan({
      script,
      backgroundImagePath: path.resolve(backgroundPath),
      itemImagePaths: [
        path.resolve(imagePaths[0]),
        path.resolve(imagePaths[1]),
        path.resolve(imagePaths[2]),
      ],
      audioPath: opts.narration ? path.resolve(opts.narration) : undefined,
      bgmPath: opts.bgm ? path.resolve(opts.bgm) : undefined,
      rankSfxPath: opts.rankSfx ? path.resolve(opts.rankSfx) : undefined,
      hookSfxPath: opts.hookSfx ? path.resolve(opts.hookSfx) : undefined,
      id: planId,
    });

    const finalOut =
      outPath ??
      path.join(
        (await import("./config.js")).dataPath("ranking-plans"),
        `${plan.id}.json`,
      );
    writeRankingPlan(plan, finalOut);
    console.log(chalk.green(`✅ ranking-plan 保存: ${finalOut}`));
    console.log(chalk.dim(`   id=${plan.id} / duration=${plan.totalDurationSec}s`));
    console.log(chalk.bold("\n次のステップ:"));
    const renderCmd = opts.jobId
      ? `pnpm --filter @rekishi/pipeline exec tsx src/cli.ts render-ranking --channel ${opts.channel} --job-id ${opts.jobId}`
      : `pnpm --filter @rekishi/pipeline exec tsx src/cli.ts render-ranking --plan ${finalOut}`;
    console.log(`  ${chalk.cyan(renderCmd)}`);
  });

program
  .command("render-ranking")
  .description("既存の ranking-plan.json を読み込んで RankingShort をレンダリング")
  .option("--plan <path>", "ranking-plan.json のファイルパス")
  .option("--job-id <id>", "ジョブID。data/<channel>/scripts/<id>/ranking-plan.json を読む")
  .option("--out <path>", "出力 mp4 のパス", "")
  .addOption(channelOption())
  .action(async (opts) => {
    let planPath: string | undefined = opts.plan;
    if (!planPath && opts.jobId) {
      const { resolveRankingJobPaths } = await import("./ranking-paths.js");
      planPath = resolveRankingJobPaths(opts.jobId).planJson;
    }
    if (!planPath) throw new Error("--plan または --job-id のいずれかが必要です");
    if (!fs.existsSync(planPath)) {
      throw new Error(`ranking-plan.json が見当たりません: ${planPath}`);
    }
    const planRaw = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    const plan = RankingPlanSchema.parse(planRaw);
    const outputPath =
      opts.out ||
      path.join(getJobOutputDir(), `ranking-${plan.id}.mp4`);
    const { renderRankingShort } = await import("@rekishi/renderer");
    console.log(chalk.bold(`\n🎥 RankingShort をレンダリング中...`));
    await renderRankingShort(plan, outputPath);
    console.log(chalk.green(`\n✅ 完成: ${outputPath}`));
  });

program.parseAsync().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
  process.exit(1);
});
