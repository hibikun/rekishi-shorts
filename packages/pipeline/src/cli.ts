#!/usr/bin/env node
import { Command, Option } from "commander";
import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { RankingPlanSchema, TopicSchema } from "@rekishi/shared";
import { DEFAULT_CHANNEL, channelSubjectDefault, setChannel } from "@rekishi/shared/channel";
import {
  generatePlan,
  getJobOutputDir,
  runBuildStage,
  runDraftStage,
  runRealignStage,
  runResearchStage,
} from "./orchestrator.js";
import { config } from "./config.js";

function channelOption(): Option {
  return new Option("--channel <id>", "チャンネルID (rekishi | kosei ...)").default(DEFAULT_CHANNEL);
}

/**
 * CLI に渡された相対パスを repo root 基準で解決する。
 * pnpm monorepo では cwd が `packages/pipeline/` になるため、絶対パス以外は
 * 必ず repo root 起点で解釈し、cwd 依存の混乱を避ける。
 */
function resolveCliPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(config.paths.repoRoot, p);
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
  .option("--subject <subject>", "科目（省略時は channel ごとのデフォルト）")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--format <format>", "台本フォーマット（single | three-pick）", "single")
  .addOption(channelOption())
  .action(async (opts) => {
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject ?? channelSubjectDefault(),
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
  .option("--subject <subject>", "科目（省略時は channel ごとのデフォルト）")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--format <format>", "台本フォーマット（single | three-pick）", "single")
  .option("--job <jobId>", "既存の research ジョブを引き継ぐ（research.md をプロンプトに注入）")
  .addOption(channelOption())
  .action(async (opts) => {
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject ?? channelSubjectDefault(),
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
  .option("--subject <subject>", "科目（省略時は channel ごとのデフォルト）")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--format <format>", "台本フォーマット（single | three-pick）", "single")
  .option("--no-generate-images", "Nano Banana 画像生成をスキップし Wikimedia のみ")
  .option("--plan-only", "RenderPlan 生成まで（レンダリングしない）")
  .addOption(channelOption())
  .action(async (opts) => {
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject ?? channelSubjectDefault(),
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
  .option("--subject <subject>", "科目（省略時は channel ごとのデフォルト）")
  .option("--target <target>", "", "汎用")
  .option("--format <format>", "", "single")
  .option("--out <path>", "script.json の書き出し先。省略時は stdout")
  .option(
    "--job-id <id>",
    "ジョブID。指定すると data/<channel>/scripts/<id>/script.json に保存し NEXT_STEPS.md も出力",
  )
  .option(
    "--research-file <path>",
    "プロンプトの {{research}} に注入する markdown ファイル（手動リサーチ資料）",
  )
  .addOption(channelOption())
  .action(async (opts) => {
    const { generateScript } = await import("./script-generator.js");
    const topic = TopicSchema.parse({
      title: opts.topic,
      era: opts.era,
      subject: opts.subject ?? channelSubjectDefault(),
      target: opts.target,
      format: opts.format,
    });
    let researchMd: string | undefined;
    if (opts.researchFile) {
      const researchPath = resolveCliPath(opts.researchFile);
      if (!fs.existsSync(researchPath)) {
        throw new Error(`research file が見当たりません: ${researchPath}`);
      }
      researchMd = fs.readFileSync(researchPath, "utf-8");
      console.log(chalk.dim(`📚 research-file: ${researchPath} (${researchMd.length} chars)`));
    }
    const { script } = await generateScript(topic, researchMd);
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
          config.paths.repoRoot,
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
      const outPath = resolveCliPath(opts.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, json);
      console.log(chalk.green(`✅ script 保存: ${outPath}`));
    } else {
      console.log(json);
    }
  });

program
  .command("tts-only")
  .description(
    "script.json から Gemini TTS でナレーション音声を合成（ranking 手動フロー用）",
  )
  .option("--job-id <id>", "ジョブID。指定すると script.json を読み narration.wav を出力")
  .option("--script <path>", "script.json のパス（--job-id 指定時は省略可）")
  .option("--out <path>", "narration の書き出し先（省略時は <job>/narration.wav or stdout エラー）")
  .option(
    "--legacy-single-voice",
    "narrationSegments があってもセグメント別 TTS を使わず、従来通り narration を 1 本で合成する",
  )
  .addOption(channelOption())
  .action(async (opts) => {
    const { synthesizeNarration } = await import("./tts-generator.js");
    const { FURIGANA_MAP } = await import("./furigana.js");
    const { readScriptFile } = await import("./ranking-plan-builder.js");

    let scriptPath: string | undefined = opts.script ? resolveCliPath(opts.script) : undefined;
    let outPath: string | undefined = opts.out ? resolveCliPath(opts.out) : undefined;
    let clipsDir: string | undefined;
    let audioClipsJsonPath: string | undefined;

    if (opts.jobId) {
      const { resolveRankingJobPaths } = await import("./ranking-paths.js");
      const paths = resolveRankingJobPaths(opts.jobId);
      scriptPath = scriptPath ?? paths.scriptJson;
      outPath = outPath ?? paths.narrationWav;
      clipsDir = paths.ttsClipsDir;
      audioClipsJsonPath = paths.audioClipsJson;
    }

    if (!scriptPath) throw new Error("--script または --job-id のいずれかが必要です");
    if (!outPath) throw new Error("--out または --job-id のいずれかが必要です");
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`script.json が見当たりません: ${scriptPath}`);
    }

    const script = readScriptFile(scriptPath);

    // 案G改: narrationSegments + items.reviews があれば segment 別 TTS パイプラインに分岐。
    // ただし --legacy-single-voice や clipsDir 不在 (--out 単独指定など) の場合は従来フロー。
    const useSegmentFlow =
      !opts.legacySingleVoice &&
      !!script.narrationSegments &&
      script.narrationSegments.length > 0 &&
      !!script.items &&
      script.items.length >= 3 &&
      !!clipsDir &&
      !!audioClipsJsonPath;

    if (useSegmentFlow) {
      const { sha256File, synthesizeRankingClips, writeAudioClipsJson } = await import(
        "./ranking-tts.js"
      );

      console.log(
        chalk.bold(
          `\n🎙️  Gemini TTS でセグメント別合成中（5 narrator + 9 review）...`,
        ),
      );
      console.log(chalk.dim(`   script  : ${scriptPath}`));
      console.log(
        chalk.dim(
          `   segments: ${script.narrationSegments!.length} 枠 / reviews: ${
            script.items!.reduce((s, it) => s + (it.reviews?.length ?? 0), 0)
          } 件`,
        ),
      );
      console.log(chalk.dim(`   clips   : ${clipsDir}`));

      // narrator/reviewer の声はチャンネル別 default + env で resolveNarratorVoice / resolveReviewerVoices が決める。
      const result = await synthesizeRankingClips({
        script,
        clipsDir: clipsDir!,
        combinedOutPath: outPath,
        readings: script.readings,
        furigana: FURIGANA_MAP,
      });

      writeAudioClipsJson(
        result.audioClips,
        result.totalDurationSec,
        audioClipsJsonPath!,
        {
          scriptHash: sha256File(scriptPath),
          combinedAudioHash: sha256File(result.combinedPath),
        },
      );

      // コスト試算（cost-tracker と同じ料金式: input $1.0/1M, output $20.0/1M, ¥150/$）
      const usdInput = (result.usage.inputTokens / 1_000_000) * 1.0;
      const usdOutput = (result.usage.outputTokens / 1_000_000) * 20.0;
      const usdTotal = usdInput + usdOutput;
      const jpyTotal = usdTotal * 150;

      console.log(chalk.green(`\n✅ narration 結合保存: ${result.combinedPath}`));
      console.log(
        chalk.dim(
          `   ${result.characters}文字 / 合成${result.totalDurationSec.toFixed(2)}秒 / 14クリップ / model=${result.usage.model}`,
        ),
      );
      console.log(
        chalk.dim(
          `   tokens in=${result.usage.inputTokens} out=${result.usage.outputTokens} → 試算 $${usdTotal.toFixed(5)} (¥${jpyTotal.toFixed(2)})`,
        ),
      );
      console.log(chalk.dim(`   📄 audioClips: ${audioClipsJsonPath}`));

      if (opts.jobId) {
        console.log(chalk.bold("\n次のステップ:"));
        console.log(
          `  ${chalk.cyan(
            `pnpm --filter @rekishi/pipeline exec tsx src/cli.ts build-ranking-plan --channel ${opts.channel} --job-id ${opts.jobId}`,
          )}`,
        );
      }
      return;
    }

    // 従来フロー: 1 本合成 → build-ranking-plan で scene-aligner にかける
    console.log(chalk.bold(`\n🎙️  Gemini TTS でナレーション合成中（単一ボイス）...`));
    console.log(chalk.dim(`   script: ${scriptPath}`));
    console.log(chalk.dim(`   text  : ${script.narration.length}文字`));

    const tts = await synthesizeNarration(script.narration, outPath, {
      readings: script.readings,
      furigana: FURIGANA_MAP,
      hook: script.hook,
    });

    if (opts.legacySingleVoice && audioClipsJsonPath && fs.existsSync(audioClipsJsonPath)) {
      fs.unlinkSync(audioClipsJsonPath);
      console.log(
        chalk.dim(
          `   古い audioClips manifest を削除: ${audioClipsJsonPath}`,
        ),
      );
    }

    console.log(chalk.green(`\n✅ narration 保存: ${tts.path}`));
    console.log(
      chalk.dim(
        `   ${tts.characters}文字 / 合成${tts.approxDurationSec.toFixed(2)}秒 / model=${tts.usage.model}`,
      ),
    );

    if (opts.jobId) {
      console.log(chalk.bold("\n次のステップ:"));
      console.log(
        `  ${chalk.cyan(
          `pnpm --filter @rekishi/pipeline exec tsx src/cli.ts build-ranking-plan --channel ${opts.channel} --job-id ${opts.jobId} --narration ${tts.path}`,
        )}`,
      );
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
  .option(
    "--skip-align",
    "scene-planner / aligner を実行せず、固定尺フォールバックで ranking-plan を出す（デバッグ用）",
  )
  .addOption(channelOption())
  .action(async (opts) => {
    const { buildRankingPlan, readScriptFile, writeRankingPlan } = await import(
      "./ranking-plan-builder.js"
    );

    let scriptPath: string | undefined = opts.script ? resolveCliPath(opts.script) : undefined;
    let backgroundPath: string | undefined = opts.background
      ? resolveCliPath(opts.background)
      : undefined;
    let imagePaths: [string, string, string] | undefined;
    let outPath: string | undefined = opts.out ? resolveCliPath(opts.out) : undefined;
    let planId: string | undefined = opts.id;
    let narrationPath: string | undefined = opts.narration
      ? resolveCliPath(opts.narration)
      : undefined;

    let audioClipsJsonPath: string | undefined;

    if (opts.jobId) {
      const { resolveRankingJobPaths, resolveRankingAssets } = await import(
        "./ranking-paths.js"
      );
      const paths = resolveRankingJobPaths(opts.jobId);
      scriptPath = scriptPath ?? paths.scriptJson;
      outPath = outPath ?? paths.planJson;
      planId = planId ?? opts.jobId;
      if (!narrationPath && fs.existsSync(paths.narrationWav)) {
        narrationPath = paths.narrationWav;
      }
      audioClipsJsonPath = paths.audioClipsJson;

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
        resolveCliPath(parsed[0]!),
        resolveCliPath(parsed[1]!),
        resolveCliPath(parsed[2]!),
      ];
    }

    const script = readScriptFile(scriptPath);

    // ===== TTS↔スライド整合パイプライン =====
    // 案G改: audio-clips.json (segment 別 TTS パイプラインの成果物) があれば
    //         scene-aligner を skip し、scenes と audioClips をそのまま採用する。
    // それ以外: narration があれば scene-planner → ASR → scene-aligner を従来どおり回す。
    // 未配置 / --skip-align の場合は scenes 抜き（コンポ側で固定尺フォールバック）。
    let alignedScenes: import("@rekishi/shared").Scene[] | undefined;
    let audioClips: import("@rekishi/shared").AudioClip[] | undefined;

    if (audioClipsJsonPath && fs.existsSync(audioClipsJsonPath) && !opts.skipAlign) {
      const { readAudioClipsJson, sha256File } = await import("./ranking-tts.js");
      const data =
        narrationPath && fs.existsSync(narrationPath)
          ? readAudioClipsJson(audioClipsJsonPath, {
              scriptHash: sha256File(scriptPath),
              combinedAudioHash: sha256File(narrationPath),
            })
          : null;
      if (data) {
        audioClips = data.audioClips;
        // audioClips から 8 シーンを再構築（順序: opening / r3-intro / r3-review / r2-intro / r2-review / r1-intro / r1-review / closing）
        const sumDur = (predicate: (c: import("@rekishi/shared").AudioClip) => boolean): number => {
          const sum = data.audioClips
            .filter(predicate)
            .reduce((s, c) => s + c.durationSec, 0);
          return Math.max(0.01, Number(sum.toFixed(3)));
        };
        const segText = (kind: string): string =>
          script.narrationSegments?.find((s) => s.kind === kind)?.text ?? "";
        const reviewText = (rank: 1 | 2 | 3): string => {
          const it = script.items?.find((x) => x.rank === rank);
          return it?.reviews?.join(" / ") ?? "";
        };
        const scenes: import("@rekishi/shared").Scene[] = [];
        scenes.push({
          index: 0,
          narration: segText("opening"),
          imageQueryJa: "",
          imageQueryEn: "",
          imagePromptEn: "",
          durationSec: sumDur((c) => c.kind === "opening"),
        });
        let idx = 1;
        for (const rank of [3, 2, 1] as const) {
          scenes.push({
            index: idx++,
            narration: segText(`rank${rank}-intro`),
            imageQueryJa: "",
            imageQueryEn: "",
            imagePromptEn: "",
            durationSec: sumDur((c) => c.kind === "rank-intro" && c.rank === rank),
          });
          scenes.push({
            index: idx++,
            narration: reviewText(rank),
            imageQueryJa: "",
            imageQueryEn: "",
            imagePromptEn: "",
            durationSec: sumDur((c) => c.kind === "review" && c.rank === rank),
          });
        }
        scenes.push({
          index: 7,
          narration: segText("closing"),
          imageQueryJa: "",
          imageQueryEn: "",
          imagePromptEn: "",
          durationSec: sumDur((c) => c.kind === "closing"),
        });
        alignedScenes = scenes;
        console.log(
          chalk.bold(
            "\n🎯 audioClips manifest を検出: scene-aligner を skip し、TTS タイミングをそのまま採用します",
          ),
        );
        console.log(
          chalk.dim(
            `   ${data.audioClips.length}クリップ / 合計${data.totalDurationSec.toFixed(2)}秒`,
          ),
        );
      } else {
        console.log(
          chalk.yellow(
            "\n⚠️  audioClips manifest は現在の script/narration と一致しないため無視します",
          ),
        );
      }
    }

    if (!alignedScenes && narrationPath && !opts.skipAlign) {
      if (!fs.existsSync(narrationPath)) {
        throw new Error(`narration ファイルが見当たりません: ${narrationPath}`);
      }
      const { planScenes } = await import("./scene-planner.js");
      const { alignCaptions } = await import("./asr-aligner.js");
      const { alignScenesToAudio } = await import("./scene-aligner.js");

      console.log(chalk.bold("\n🎬 [1/3] Gemini で 8シーン分割中..."));
      const sceneResult = await planScenes(script);
      const scenePlan = sceneResult.plan;
      console.log(
        chalk.dim(
          `   ${scenePlan.scenes.length}シーン / in=${sceneResult.usage.inputTokens}tok out=${sceneResult.usage.outputTokens}tok`,
        ),
      );
      if (scenePlan.scenes.length !== 8) {
        throw new Error(
          `scene-planner returned ${scenePlan.scenes.length} scenes; ranking three-pick requires exactly 8 scenes.`,
        );
      }

      console.log(
        chalk.bold("\n📝 [2/3] Whisper + gpt-4o-mini-transcribe で字幕タイムスタンプ取得中..."),
      );
      const alignResult = await alignCaptions(narrationPath, {
        scriptText: script.narration,
        readings: script.readings,
        keyTerms: script.keyTerms,
      });
      const { words, totalDurationSec, brokenByGuard, qualitySignals } = alignResult;
      if (brokenByGuard) {
        console.log(
          chalk.yellow(`   ⚠ whisper-1 が破綻検出: ${qualitySignals.reasons.join(", ")}`),
        );
        console.log(chalk.yellow(`     → script.narration を線形配分した words に置換しました`));
      }
      console.log(chalk.dim(`   ${words.length}単語 / 実測${totalDurationSec.toFixed(2)}秒`));

      console.log(chalk.bold("\n🪡 [3/3] scene-aligner でシーン境界を実音声に合わせる..."));
      const alignment = alignScenesToAudio(scenePlan.scenes, words, totalDurationSec, {
        audioPath: narrationPath,
        brokenAsr: brokenByGuard,
      });
      if (alignment.vadUsed) {
        console.log(
          chalk.cyan(
            `   🎯 VAD-based scene boundaries: ${alignment.matchedByVad}/${scenePlan.scenes.length - 1} 境界が無音マッチ`,
          ),
        );
      } else if (alignment.fallbackUsed) {
        console.log(
          chalk.yellow(`   ⚠ scene alignment fallback used — 実発話とシーン境界がズレる可能性あり`),
        );
      }
      if (alignment.scenes.length !== 8) {
        throw new Error(
          `scene-aligner returned ${alignment.scenes.length} scenes; ranking three-pick requires exactly 8 scenes.`,
        );
      }
      alignedScenes = alignment.scenes;

      // jobId 配下に scene-plan.json と words.json を保存（再アライメント用）
      if (opts.jobId) {
        const { resolveRankingJobPaths } = await import("./ranking-paths.js");
        const paths = resolveRankingJobPaths(opts.jobId);
        fs.mkdirSync(paths.root, { recursive: true });
        fs.writeFileSync(paths.scenePlanJson, JSON.stringify(scenePlan, null, 2));
        fs.writeFileSync(
          paths.wordsJson,
          JSON.stringify(
            { words, totalDurationSec, brokenByGuard, qualitySignals },
            null,
            2,
          ),
        );
        console.log(chalk.dim(`   📄 scene-plan: ${paths.scenePlanJson}`));
        console.log(chalk.dim(`   📄 words    : ${paths.wordsJson}`));
      }
    } else if (opts.skipAlign) {
      console.log(
        chalk.yellow(
          "\n⚠ --skip-align 指定: scene-aligner をスキップ（固定尺フォールバックで再生されます）",
        ),
      );
    } else {
      console.log(
        chalk.yellow(
          "\n⚠ narration 未配置: scene-aligner をスキップ（固定尺フォールバックで再生されます）",
        ),
      );
    }

    // BGM auto-detect:
    //   1. --bgm <path>                              (明示)
    //   2. data/<channel>/scripts/<id>/assets/bgm/*  (このジョブだけ別 BGM)
    //   3. packages/channels/<channel>/assets/bgm/*  (チャンネル既定)
    const { resolveBgmPath, resolveOpeningIcons, resolveRankingJobPaths } = await import(
      "./ranking-paths.js"
    );
    const jobPathsForBgm = opts.jobId ? resolveRankingJobPaths(opts.jobId) : null;
    const cliBgmAbs = opts.bgm ? resolveCliPath(opts.bgm) : null;
    const resolvedBgm = resolveBgmPath(jobPathsForBgm, opts.channel, cliBgmAbs);
    if (resolvedBgm) {
      const label =
        resolvedBgm.source === "cli-flag"
          ? "明示"
          : resolvedBgm.source === "job-override"
            ? "ジョブ override"
            : "チャンネル既定";
      console.log(
        chalk.dim(`🎵 BGM (${label}): ${path.relative(process.cwd(), resolvedBgm.path)}`),
      );
    }

    // opening-icons auto-detect (BGM と同じ優先順位):
    //   1. data/<channel>/scripts/<id>/assets/opening-icons/*  (ジョブ override)
    //   2. packages/channels/<channel>/assets/opening-icons/*  (チャンネル既定)
    const resolvedIcons = resolveOpeningIcons(jobPathsForBgm, opts.channel);
    if (resolvedIcons.paths.length > 0) {
      const iconLabel =
        resolvedIcons.source === "job-override" ? "ジョブ override" : "チャンネル既定";
      console.log(
        chalk.dim(
          `🖼️  opening-icons (${iconLabel}): ${resolvedIcons.paths.length} 枚`,
        ),
      );
    }

    const plan = buildRankingPlan({
      script,
      backgroundImagePath: resolveCliPath(backgroundPath),
      itemImagePaths: [
        resolveCliPath(imagePaths[0]),
        resolveCliPath(imagePaths[1]),
        resolveCliPath(imagePaths[2]),
      ],
      openingIconImagePaths: resolvedIcons.paths,
      audioPath: narrationPath,
      bgmPath: resolvedBgm?.path,
      rankSfxPath: opts.rankSfx ? resolveCliPath(opts.rankSfx) : undefined,
      hookSfxPath: opts.hookSfx ? resolveCliPath(opts.hookSfx) : undefined,
      id: planId,
      scenes: alignedScenes,
      audioClips,
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
    let planPath: string | undefined = opts.plan ? resolveCliPath(opts.plan) : undefined;
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
    const outputPath = opts.out
      ? resolveCliPath(opts.out)
      : path.join(getJobOutputDir(), `ranking-${plan.id}.mp4`);
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
