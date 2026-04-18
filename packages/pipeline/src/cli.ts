#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import { TopicSchema } from "@rekishi/shared";
import { generatePlan, getJobOutputDir } from "./orchestrator.js";
import { dataPath } from "./config.js";

const program = new Command();

program
  .name("rekishi-shorts")
  .description("受験生向け歴史ショート動画の自動生成 CLI")
  .version("0.1.0");

program
  .command("generate")
  .description("台本生成からレンダリングまで一気通貫で実行")
  .requiredOption("--topic <title>", "トピック名（例: ペリー来航）")
  .option("--era <era>", "時代（例: 幕末）")
  .option("--subject <subject>", "科目（日本史 | 世界史）", "日本史")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--no-generate-images", "Nano Banana 画像生成をスキップし Wikimedia のみ")
  .option("--plan-only", "RenderPlan 生成まで（レンダリングしない）")
  .action(async (opts) => {
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject,
      target: opts.target,
    });
    console.log(chalk.bold(`\n🎞️  rekishi-shorts: ${topic.title}\n`));

    const plan = await generatePlan({
      topic,
      allowImageGeneration: opts.generateImages !== false,
    });

    if (opts.planOnly) {
      console.log(chalk.yellow("\n--plan-only 指定のためレンダリングをスキップします"));
      return;
    }

    const { renderHistoryShort } = await import("@rekishi/renderer");
    const outputPath = path.join(getJobOutputDir(), `${plan.id}.mp4`);
    console.log(chalk.bold(`\n🎥 Remotion でレンダリング中...`));
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
  .action(async (opts) => {
    const { generateScript } = await import("./script-generator.js");
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject,
      target: opts.target,
    });
    const script = await generateScript(topic);
    console.log(JSON.stringify(script, null, 2));
  });

program.parseAsync().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
  process.exit(1);
});
