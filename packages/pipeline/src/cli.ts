#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import { TopicSchema } from "@rekishi/shared";
import {
  generatePlan,
  getJobOutputDir,
  runBuildStage,
  runDraftStage,
  runRealignStage,
  runResearchStage,
} from "./orchestrator.js";

function buildOutputFilename(title: string, jobId: string): string {
  const safe = title.replace(/[\/\\:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  return safe ? `${safe}-${jobId}.mp4` : `${jobId}.mp4`;
}

const program = new Command();

program
  .name("rekishi-shorts")
  .description("受験生向け歴史ショート動画の自動生成 CLI")
  .version("0.1.0");

program
  .command("research")
  .description("Gemini + Google Search でトピックのリサーチ資料（research.md）を生成。draft の前段")
  .requiredOption("--topic <title>", "トピック名（例: 生類憐みの令）")
  .option("--era <era>", "時代（例: 江戸）")
  .option("--subject <subject>", "科目（日本史 | 世界史）", "日本史")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--format <format>", "台本フォーマット（single | three-pick）", "single")
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
  .requiredOption("--plan-id <id>", "ジョブID（data/scripts/<id>/ 配下）")
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
    console.log(JSON.stringify(script, null, 2));
  });

program.parseAsync().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
  process.exit(1);
});
