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
  .description("Gemini + Google Search でトピックのリサーチ資料（research.md）を生成。draft / script-only の前段")
  .requiredOption("--topic <title>", "トピック名（例: 生類憐みの令）")
  .option("--era <era>", "時代 / 絞り込み条件（ranking では「20代後半〜30代男性」など）")
  .option("--subject <subject>", "科目 / カテゴリ（省略時は channel ごとのデフォルト）")
  .option("--target <target>", "対象試験（共通テスト | 二次 | 汎用）", "汎用")
  .option("--format <format>", "台本フォーマット（single | three-pick）", "single")
  .option("--job-id <id>", "ジョブID（指定時は data/<channel>/scripts/<id>/research.md に保存。後段の script-only で auto-detect される）")
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

    const { jobId, researchPath, tracker, sourceCount, queryCount } = await runResearchStage(topic, opts.jobId);
    console.log(chalk.green(`\n✅ research 保存: ${researchPath}`));
    console.log(chalk.dim(`   jobId=${jobId} / sources=${sourceCount} / queries=${queryCount}`));
    console.log(chalk.bold("\n次のステップ:"));
    console.log(`  1. ${chalk.cyan(researchPath)} を開いて内容確認（必要なら編集）`);
    if (opts.channel === "ranking") {
      const subjectFlag = topic.subject ? ` --subject "${topic.subject}"` : "";
      const eraFlag = topic.era ? ` --era "${topic.era}"` : "";
      const formatFlag = topic.format ? ` --format ${topic.format}` : "";
      console.log(
        `  2. ${chalk.cyan(
          `pnpm --filter @rekishi/pipeline exec tsx src/cli.ts script-only --channel ranking --job-id ${jobId} --topic "${topic.title}"${subjectFlag}${eraFlag}${formatFlag}`,
        )} で台本生成（research.md を自動注入）`,
      );
    } else {
      console.log(`  2. ${chalk.cyan(`pnpm draft --job ${jobId} --topic "${topic.title}"${topic.era ? ` --era "${topic.era}"` : ""}`)} で台本生成`);
    }
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
    let jobPaths: Awaited<
      ReturnType<typeof import("./ranking-paths.js")["resolveRankingJobPaths"]>
    > | undefined;
    if (opts.jobId) {
      const { resolveRankingJobPaths } = await import("./ranking-paths.js");
      jobPaths = resolveRankingJobPaths(opts.jobId);
    }

    let researchMd: string | undefined;
    if (opts.researchFile) {
      const researchPath = resolveCliPath(opts.researchFile);
      if (!fs.existsSync(researchPath)) {
        throw new Error(`research file が見当たりません: ${researchPath}`);
      }
      researchMd = fs.readFileSync(researchPath, "utf-8");
      console.log(chalk.dim(`📚 research-file: ${researchPath} (${researchMd.length} chars)`));
    } else if (jobPaths) {
      const autoResearchPath = path.join(jobPaths.root, "research.md");
      if (fs.existsSync(autoResearchPath)) {
        researchMd = fs.readFileSync(autoResearchPath, "utf-8");
        console.log(
          chalk.dim(
            `📚 research auto-detected: ${autoResearchPath} (${researchMd.length} chars)`,
          ),
        );
      }
    }
    const { script } = await generateScript(topic, researchMd);
    const json = JSON.stringify(script, null, 2);

    if (jobPaths) {
      const paths = jobPaths;
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
          jobId: paths.jobId,
          channel: opts.channel,
          assetsDirRelative,
        });
        fs.writeFileSync(paths.nextStepsMd, md);
        console.log(chalk.green(`📝 NEXT_STEPS 保存: ${paths.nextStepsMd}`));
        console.log();
        console.log(chalk.bold("次の手順:"));
        for (const line of buildStdoutGuideLines({
          script,
          jobId: paths.jobId,
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
  .command("scene-plan")
  .description("既存ジョブの draft.md/script.json からシーン分割のみ実行（TTS/画像/レンダなし）")
  .requiredOption("--job-id <id>", "draft で生成したジョブID")
  .addOption(channelOption())
  .action(async (opts) => {
    const { loadScriptFromJob } = await import("./orchestrator.js");
    const { planScenes } = await import("./scene-planner.js");
    const { jobPath } = await import("./storage/local.js");

    console.log(chalk.bold(`\n🎬 rekishi-shorts scene-plan preview: ${opts.jobId}\n`));
    const script = await loadScriptFromJob(opts.jobId);
    const { plan, usage } = await planScenes(script);

    const outPath = jobPath(opts.jobId, "scripts", "scene-plan.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));

    console.log(chalk.green(`✅ scene-plan 保存: ${outPath}`));
    console.log(chalk.dim(`   ${plan.scenes.length}シーン / in=${usage.inputTokens}tok out=${usage.outputTokens}tok`));
    console.log();
    for (const s of plan.scenes) {
      console.log(chalk.bold(`#${s.index} (${s.durationSec}s)`));
      console.log(`  ナレ: ${s.narration}`);
      console.log(chalk.dim(`  画像クエリ(JA): ${s.imageQueryJa}`));
      console.log(chalk.dim(`  画像クエリ(EN): ${s.imageQueryEn}`));
      console.log(chalk.dim(`  生成プロンプト: ${s.imagePromptEn}`));
      console.log();
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
    const cliBackgroundPath: string | null = opts.background
      ? resolveCliPath(opts.background)
      : null;
    let imagePaths: [string, string, string] | undefined;
    let outPath: string | undefined = opts.out ? resolveCliPath(opts.out) : undefined;
    let planId: string | undefined = opts.id;
    let narrationPath: string | undefined = opts.narration
      ? resolveCliPath(opts.narration)
      : undefined;

    let audioClipsJsonPath: string | undefined;

    const { resolveRankingJobPaths, resolveRankingAssets, resolveBackgroundPath } =
      await import("./ranking-paths.js");

    let jobPaths: ReturnType<typeof resolveRankingJobPaths> | null = null;

    if (opts.jobId) {
      jobPaths = resolveRankingJobPaths(opts.jobId);
      scriptPath = scriptPath ?? jobPaths.scriptJson;
      outPath = outPath ?? jobPaths.planJson;
      planId = planId ?? opts.jobId;
      if (!narrationPath && fs.existsSync(jobPaths.narrationWav)) {
        narrationPath = jobPaths.narrationWav;
      }
      audioClipsJsonPath = jobPaths.audioClipsJson;

      if (!opts.images) {
        if (!fs.existsSync(jobPaths.assetsDir)) {
          throw new Error(
            `アセットディレクトリが見当たりません: ${jobPaths.assetsDir}\n` +
              `先に script-only --job-id ${opts.jobId} を実行し、画像を配置してください。`,
          );
        }
        const { itemImages, missing } = resolveRankingAssets(jobPaths.assetsDir);
        if (missing.length > 0) {
          const script = fs.existsSync(jobPaths.scriptJson)
            ? readScriptFile(jobPaths.scriptJson)
            : null;
          const items = script?.items ?? [];
          console.error(chalk.red(`\n❌ 画像ファイルが見つかりません:`));
          for (const name of missing) {
            const m = name.match(/^item-(\d)$/);
            const rank = m ? Number(m[1]) : null;
            const it = rank ? items.find((x) => x.rank === rank) : null;
            const ref = it?.officialUrl || it?.affiliateUrl || it?.searchKeywords;
            console.error(
              chalk.red(`  - ${name}.(png|webp|jpg|jpeg) が ${jobPaths.assetsDir}/ に不在`),
            );
            if (it?.name) console.error(chalk.dim(`      商品: ${it.name}`));
            if (ref) console.error(chalk.dim(`      参考: ${ref}`));
          }
          console.error(chalk.yellow(`\n→ NEXT_STEPS.md を参照: ${jobPaths.nextStepsMd}`));
          process.exit(1);
        }
        imagePaths = itemImages;
      }
    }

    // 背景画像は 3 ルートで解決:
    //   1. --background <path> (cli-flag)
    //   2. data/<channel>/scripts/<id>/assets/background.* (job-override)
    //   3. packages/channels/<channel>/assets/backgrounds/* (channel-default、夜桜等)
    const bgResolved = resolveBackgroundPath(jobPaths, opts.channel, cliBackgroundPath);
    if (!bgResolved) {
      throw new Error(
        "背景画像が見つかりません。次のいずれかを用意してください:\n" +
          "  - --background <path> で明示指定\n" +
          "  - data/<channel>/scripts/<id>/assets/background.{png|webp|jpg|jpeg} (ジョブ別)\n" +
          `  - packages/channels/${opts.channel}/assets/backgrounds/<file> (チャンネル既定)`,
      );
    }
    const backgroundPath: string = bgResolved.path;
    const bgRelative = path.relative(config.paths.repoRoot, backgroundPath);
    const bgLabel =
      bgResolved.source === "channel-default"
        ? "チャンネル既定"
        : bgResolved.source === "job-override"
          ? "ジョブ別"
          : "CLI 指定";
    console.log(chalk.dim(`🌃 背景画像 (${bgLabel}): ${bgRelative}`));

    if (!scriptPath) throw new Error("--script または --job-id のいずれかが必要です");

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
    const { resolveBgmPath, resolveOpeningIcons } = await import(
      "./ranking-paths.js"
    );
    const jobPathsForBgm = jobPaths;
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

// ============================================================
// ukiyoe チャンネル: 浮世絵タッチ × img2video 動画
// 既存 rekishi/ranking/kosei コマンドには触らない
// ============================================================

program
  .command("ukiyoe-generate")
  .description(
    "ukiyoe チャンネルを一気通貫で生成（script→scene-plan→images→videos→tts→render）",
  )
  .requiredOption("--topic <title>", "トピック（例: 継飛脚）")
  .option("--era <era>", "時代（例: 江戸）")
  .option("--scenes <n>", "シーン数（5秒×N、試作は4で短尺化）", "4")
  .option(
    "--research-file <path>",
    "research markdown を script-routine プロンプトに流し込む",
  )
  .option("--job-id <id>", "ジョブID。省略時は timestamp ベース")
  .option("--no-images", "image-gen を skip（既存 scene-NN.png を使う）")
  .option("--no-videos", "video-gen を skip（既存 scene-NN.mp4 を使う）")
  .option("--no-tts", "TTS を skip（既存 narration.wav を使う）")
  .option("--no-render", "Remotion レンダリングを skip")
  .action(async (opts) => {
    setChannel("ukiyoe");

    const sceneCount = Number.parseInt(opts.scenes, 10);
    if (!Number.isInteger(sceneCount) || sceneCount < 2 || sceneCount > 12) {
      throw new Error(`--scenes は 2〜12 の整数で指定してください（got: ${opts.scenes}）`);
    }

    const jobId =
      opts.jobId ??
      `ukiyoe-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

    const { resolveUkiyoeJobPaths, sceneImagePath } = await import(
      "./ukiyoe-paths.js"
    );
    const paths = resolveUkiyoeJobPaths(jobId);
    fs.mkdirSync(paths.root, { recursive: true });

    console.log(chalk.bold(`\n🎴 ukiyoe-generate`));
    console.log(chalk.dim(`   topic   : ${opts.topic}`));
    console.log(chalk.dim(`   scenes  : ${sceneCount} (${sceneCount * 5}s total)`));
    console.log(chalk.dim(`   jobId   : ${jobId}`));
    console.log(chalk.dim(`   root    : ${paths.root}`));

    // ---- 1. script ----
    let script: import("./ukiyoe-script-generator.js").UkiyoeScript;
    if (fs.existsSync(paths.scriptJson)) {
      console.log(chalk.dim(`\n📝 script 既存: ${paths.scriptJson}`));
      script = JSON.parse(
        fs.readFileSync(paths.scriptJson, "utf-8"),
      ) as import("./ukiyoe-script-generator.js").UkiyoeScript;
    } else {
      console.log(chalk.bold(`\n📝 [1/7] script generation...`));
      const { generateUkiyoeScript } = await import("./ukiyoe-script-generator.js");
      const researchMd = opts.researchFile
        ? fs.readFileSync(resolveCliPath(opts.researchFile), "utf-8")
        : undefined;
      const result = await generateUkiyoeScript({
        topic: opts.topic,
        era: opts.era,
        researchMd,
        targetSceneCount: sceneCount,
        targetDurationSec: sceneCount * 5,
      });
      script = result.script;
      fs.writeFileSync(paths.scriptJson, JSON.stringify(script, null, 2));
      console.log(chalk.green(`   saved: ${paths.scriptJson}`));
      console.log(chalk.dim(`   tokens in=${result.usage.inputTokens} out=${result.usage.outputTokens}`));
    }

    // ---- 2. scene-plan ----
    let scenePlan: import("./ukiyoe-scene-planner.js").UkiyoeScenePlan;
    if (fs.existsSync(paths.scenePlanJson)) {
      console.log(chalk.dim(`\n🎬 scene-plan 既存: ${paths.scenePlanJson}`));
      scenePlan = JSON.parse(
        fs.readFileSync(paths.scenePlanJson, "utf-8"),
      ) as import("./ukiyoe-scene-planner.js").UkiyoeScenePlan;
    } else {
      console.log(chalk.bold(`\n🎬 [2/7] scene-plan...`));
      const { planUkiyoeScenes } = await import("./ukiyoe-scene-planner.js");
      const result = await planUkiyoeScenes(script);
      scenePlan = result.plan;
      fs.writeFileSync(paths.scenePlanJson, JSON.stringify(scenePlan, null, 2));
      console.log(chalk.green(`   saved: ${paths.scenePlanJson}`));
      for (const s of scenePlan.scenes) {
        console.log(chalk.dim(`   scene[${s.index}] ${s.actionTag} | ${s.narration}`));
      }
    }

    // ---- 3. images ----
    if (opts.images !== false) {
      console.log(chalk.bold(`\n🎨 [3/7] image-gen (${scenePlan.scenes.length} scenes)...`));
      const { generateUkiyoeImages } = await import("./ukiyoe-image-generator.js");
      await generateUkiyoeImages(
        scenePlan.scenes.map((s) => ({ index: s.index, scenePrompt: s.imagePrompt })),
        paths.imagesDir,
        { skipExisting: true, concurrency: 3 },
      );
    } else {
      console.log(chalk.yellow(`\n⚠ image-gen skipped (--no-images)`));
    }

    // ---- 4. videos ----
    if (opts.videos !== false) {
      console.log(chalk.bold(`\n🎥 [4/7] video-gen (${scenePlan.scenes.length} scenes)...`));
      const { generateUkiyoeVideos } = await import("./ukiyoe-video-generator.js");
      await generateUkiyoeVideos(
        scenePlan.scenes.map((s) => ({
          index: s.index,
          imagePath: sceneImagePath(paths, s.index),
          scenePrompt: s.videoPrompt,
          actionTag: s.actionTag,
          cameraFixed: s.cameraFixed,
        })),
        paths.videosDir,
        { skipExisting: true, concurrency: 3 },
      );
    } else {
      console.log(chalk.yellow(`\n⚠ video-gen skipped (--no-videos)`));
    }

    // ---- 5. TTS ----
    if (opts.tts !== false && !fs.existsSync(paths.narrationWav)) {
      console.log(chalk.bold(`\n🎙️  [5/7] TTS (Gemini)...`));
      const { synthesizeNarration } = await import("./tts-generator.js");
      const { FURIGANA_MAP } = await import("./furigana.js");
      const tts = await synthesizeNarration(script.narration, paths.narrationWav, {
        readings: script.readings,
        furigana: FURIGANA_MAP,
        hook: script.hook,
      });
      console.log(
        chalk.green(
          `   saved: ${tts.path} (${tts.characters}文字, ~${tts.approxDurationSec.toFixed(2)}s)`,
        ),
      );
    } else if (fs.existsSync(paths.narrationWav)) {
      console.log(chalk.dim(`\n🎙️  TTS 既存: ${paths.narrationWav}`));
    } else {
      console.log(chalk.yellow(`\n⚠ TTS skipped (--no-tts)`));
    }

    // ---- 6. ASR alignment + caption segments ----
    console.log(chalk.bold(`\n📝 [6/7] caption alignment (Whisper)...`));
    const { alignCaptions } = await import("./asr-aligner.js");
    const alignment = await alignCaptions(paths.narrationWav, {
      scriptText: script.narration,
      readings: script.readings,
      keyTerms: script.keyTerms,
    });
    fs.writeFileSync(paths.wordsJson, JSON.stringify(alignment, null, 2));
    console.log(
      chalk.dim(`   ${alignment.words.length} words / ${alignment.totalDurationSec.toFixed(2)}s`),
    );

    // クリップ側カット方針: TTS は固定で、シーン尺をナレーション実時間に合わせて短縮する。
    // - 各シーンの終端 = そのシーンナレーション最後の語の endSec
    // - 最終シーンの終端 = WAV 全体長（自然な余韻を保持）
    const { alignUkiyoeScenes } = await import("./ukiyoe-scene-aligner.js");
    const sceneTimings = alignUkiyoeScenes({
      words: alignment.words,
      totalDurationSec: alignment.totalDurationSec,
      sceneNarrations: scenePlan.scenes.map((s) => s.narration),
    });

    const alignedScenePlan: typeof scenePlan = {
      ...scenePlan,
      totalDurationSec: sceneTimings.reduce((a, t) => a + t.durationSec, 0),
      scenes: scenePlan.scenes.map((s, i) => {
        const t = sceneTimings[i];
        if (!t) throw new Error(`scene timing missing for index ${i}`);
        return { ...s, durationSec: t.durationSec };
      }),
    };

    const captionSegments = scenePlan.scenes.map((s, i) => {
      const t = sceneTimings[i];
      if (!t) throw new Error(`scene timing missing for index ${i}`);
      return { text: s.narration, startSec: t.startSec, endSec: t.endSec };
    });

    for (const t of sceneTimings) {
      console.log(
        chalk.dim(
          `   scene[${t.index}] ${t.startSec.toFixed(2)}s → ${t.endSec.toFixed(2)}s (${t.durationSec.toFixed(2)}s)`,
        ),
      );
    }

    // ---- 7. plan + render ----
    console.log(chalk.bold(`\n🧩 [7/7] build-plan + render...`));
    const { buildUkiyoePlan, writeUkiyoePlan } = await import("./ukiyoe-plan-builder.js");
    const plan = buildUkiyoePlan({
      jobId,
      script,
      scenePlan: alignedScenePlan,
      imagesDir: paths.imagesDir,
      videosDir: paths.videosDir,
      audioPath: paths.narrationWav,
      captions: alignment.words,
      captionSegments,
    });
    writeUkiyoePlan(plan, paths.planJson);
    console.log(chalk.green(`   plan saved: ${paths.planJson}`));

    if (opts.render !== false) {
      const { renderUkiyoeShort } = await import("@rekishi/renderer");
      const outputPath = path.join(getJobOutputDir(), `${plan.id}.mp4`);
      console.log(chalk.bold(`\n🎬 Remotion レンダリング中...`));
      await renderUkiyoeShort(plan, outputPath);
      console.log(chalk.green(`\n✅ 完成: ${outputPath}`));
    }
  });

program
  .command("render-ukiyoe")
  .description("既存の ukiyoe-plan.json からレンダリングのみ実行")
  .requiredOption("--job-id <id>", "ジョブID")
  .option("--out <path>", "出力 mp4 のパス")
  .action(async (opts) => {
    setChannel("ukiyoe");
    const { resolveUkiyoeJobPaths } = await import("./ukiyoe-paths.js");
    const { readUkiyoePlan } = await import("./ukiyoe-plan-builder.js");
    const paths = resolveUkiyoeJobPaths(opts.jobId);
    if (!fs.existsSync(paths.planJson)) {
      throw new Error(`ukiyoe-plan.json が見当たりません: ${paths.planJson}`);
    }
    const plan = readUkiyoePlan(paths.planJson);
    const { renderUkiyoeShort } = await import("@rekishi/renderer");
    const outputPath = opts.out
      ? resolveCliPath(opts.out)
      : path.join(getJobOutputDir(), `${plan.id}.mp4`);
    console.log(chalk.bold(`\n🎬 Remotion レンダリング中: ${plan.id}`));
    await renderUkiyoeShort(plan, outputPath);
    console.log(chalk.green(`\n✅ 完成: ${outputPath}`));
  });

// ============================================================
// ukiyoe チャンネル: オールインワン 3 コマンド
// plan → build → ship の順で人間ゲートを 2 か所に置く
// ============================================================

async function promptForInteger(
  question: string,
  min: number,
  max: number,
): Promise<number> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    while (true) {
      const ans = (await rl.question(question)).trim();
      const n = Number.parseInt(ans, 10);
      if (Number.isInteger(n) && n >= min && n <= max) return n;
      console.log(chalk.yellow(`   ${min}〜${max} の整数を入力してください`));
    }
  } finally {
    rl.close();
  }
}

async function spawnPnpm(args: string[]): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const res = spawnSync("pnpm", args, {
    stdio: "inherit",
    cwd: config.paths.repoRoot,
  });
  if (res.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} 失敗 (exit=${res.status})`);
  }
}

program
  .command("ukiyoe-plan")
  .description(
    "ukiyoe channel: topic-pool から選択して research + script + scene-plan を生成（ゲート1の手前で停止）",
  )
  .option("--scenes <n>", "シーン数（5秒×N、デフォルトは8）", "8")
  .option("--slug <slug>", "プールから対話選択せず slug で直接指定")
  .action(async (opts) => {
    setChannel("ukiyoe");
    const sceneCount = Number.parseInt(opts.scenes, 10);
    if (!Number.isInteger(sceneCount) || sceneCount < 2 || sceneCount > 12) {
      throw new Error(`--scenes は 2〜12 の整数で指定してください`);
    }

    const { listAvailableTopics, findTopicBySlug, updateTopicStatus } =
      await import("./ukiyoe-topic-pool.js");

    let entry;
    if (opts.slug) {
      entry = await findTopicBySlug(opts.slug);
      if (!entry) {
        throw new Error(`topic-pool に slug=${opts.slug} がありません`);
      }
      if (entry.status !== "available") {
        throw new Error(
          `slug=${opts.slug} は既に ${entry.status} です（jobId=${entry.jobId ?? "?"}）`,
        );
      }
    } else {
      const candidates = await listAvailableTopics(5);
      if (candidates.length === 0) {
        throw new Error(
          "topic-pool に未使用トピックがありません。topic-pool.md を更新してください",
        );
      }
      console.log(chalk.bold("\n📚 候補（番号で選択）"));
      candidates.forEach((c, i) => {
        console.log(
          `  ${chalk.cyan(String(i + 1).padStart(2, " "))}. ${c.title}  ${chalk.dim(`[${c.category}]`)}`,
        );
      });
      const idx = await promptForInteger(
        `\n番号を入力 (1-${candidates.length}): `,
        1,
        candidates.length,
      );
      entry = candidates[idx - 1]!;
    }

    const dateStamp = new Date().toISOString().slice(0, 10);
    const jobId = `ukiyoe-${entry.slug}-${dateStamp}`;

    const { resolveUkiyoeJobPaths } = await import("./ukiyoe-paths.js");
    const paths = resolveUkiyoeJobPaths(jobId);
    fs.mkdirSync(paths.root, { recursive: true });

    console.log(chalk.bold(`\n🎴 ukiyoe-plan`));
    console.log(chalk.dim(`   topic   : ${entry.title}`));
    console.log(chalk.dim(`   slug    : ${entry.slug}`));
    console.log(chalk.dim(`   jobId   : ${jobId}`));
    console.log(chalk.dim(`   scenes  : ${sceneCount} (${sceneCount * 5}s)`));

    // 1. research (Gemini Grounding)
    if (fs.existsSync(paths.researchMd)) {
      console.log(chalk.dim(`\n🔎 research 既存: ${paths.researchMd}`));
    } else {
      console.log(chalk.bold(`\n🔎 [1/3] research (Gemini Grounding + Google Search)...`));
      const { generateResearch } = await import("./research-generator.js");
      const research = await generateResearch({
        title: entry.title,
        era: undefined,
        subject: "歴史",
        target: "汎用",
        format: "single",
      });
      fs.writeFileSync(paths.researchMd, research.markdown);
      console.log(chalk.green(`   saved: ${paths.researchMd}`));
      console.log(
        chalk.dim(`   sources=${research.sources.length} / queries=${research.queries.length}`),
      );
    }

    // 2. script
    let script: import("./ukiyoe-script-generator.js").UkiyoeScript;
    if (fs.existsSync(paths.scriptJson)) {
      console.log(chalk.dim(`\n📝 script 既存: ${paths.scriptJson}`));
      script = JSON.parse(fs.readFileSync(paths.scriptJson, "utf-8"));
    } else {
      console.log(chalk.bold(`\n📝 [2/3] script generation...`));
      const { generateUkiyoeScript } = await import("./ukiyoe-script-generator.js");
      const researchMd = fs.readFileSync(paths.researchMd, "utf-8");
      const result = await generateUkiyoeScript({
        topic: entry.title,
        era: undefined,
        researchMd,
        targetSceneCount: sceneCount,
        targetDurationSec: sceneCount * 5,
      });
      script = result.script;
      fs.writeFileSync(paths.scriptJson, JSON.stringify(script, null, 2));
      console.log(chalk.green(`   saved: ${paths.scriptJson}`));
    }

    // 3. scene-plan
    if (fs.existsSync(paths.scenePlanJson)) {
      console.log(chalk.dim(`\n🎬 scene-plan 既存: ${paths.scenePlanJson}`));
    } else {
      console.log(chalk.bold(`\n🎬 [3/3] scene-plan...`));
      const { planUkiyoeScenes } = await import("./ukiyoe-scene-planner.js");
      const result = await planUkiyoeScenes(script);
      fs.writeFileSync(paths.scenePlanJson, JSON.stringify(result.plan, null, 2));
      console.log(chalk.green(`   saved: ${paths.scenePlanJson}`));
      for (const s of result.plan.scenes) {
        console.log(chalk.dim(`   scene[${s.index}] ${s.actionTag} | ${s.narration}`));
      }
    }

    // pool を in-progress に
    await updateTopicStatus(entry.slug, "in-progress", jobId);

    console.log(chalk.bold(`\n✅ 構成生成完了 [ゲート1]`));
    console.log(chalk.bold(`\n次のステップ:`));
    console.log(`  1. ${chalk.cyan(paths.scenePlanJson)} を確認・編集`);
    console.log(`     ${chalk.cyan(paths.scriptJson)} を確認・編集`);
    console.log(`  2. OK なら ${chalk.cyan(`pnpm ukiyoe-build ${jobId}`)} で動画生成`);
  });

program
  .command("ukiyoe-build")
  .description(
    "ukiyoe channel: 既存 script + scene-plan から動画とメタドラフトを生成（ゲート2の手前で停止）",
  )
  .argument("<jobId>", "ukiyoe-plan で確保した jobId")
  .action(async (jobId: string) => {
    setChannel("ukiyoe");
    const { resolveUkiyoeJobPaths } = await import("./ukiyoe-paths.js");
    const paths = resolveUkiyoeJobPaths(jobId);
    if (!fs.existsSync(paths.scriptJson)) {
      throw new Error(
        `script.json が見つかりません: ${paths.scriptJson}\n   pnpm ukiyoe-plan を先に実行してください`,
      );
    }
    const script = JSON.parse(fs.readFileSync(paths.scriptJson, "utf-8")) as {
      topic: string;
      targetSceneCount: number;
    };

    console.log(chalk.bold(`\n🎴 ukiyoe-build ${jobId}`));
    console.log(chalk.dim(`   topic  : ${script.topic}`));
    console.log(chalk.dim(`   scenes : ${script.targetSceneCount}`));

    // image → video → TTS → render
    await spawnPnpm([
      "--filter",
      "@rekishi/pipeline",
      "exec",
      "tsx",
      "src/cli.ts",
      "ukiyoe-generate",
      "--topic",
      script.topic,
      "--scenes",
      String(script.targetSceneCount),
      "--job-id",
      jobId,
    ]);

    // meta-draft
    console.log(chalk.bold(`\n📝 meta-draft 生成...`));
    await spawnPnpm([
      "--filter",
      "@rekishi/publisher",
      "exec",
      "tsx",
      "src/cli.ts",
      "meta",
      jobId,
      "--channel",
      "ukiyoe",
    ]);

    console.log(chalk.bold(`\n✅ 動画 + メタドラフト生成完了 [ゲート2]`));
    console.log(chalk.bold(`\n次のステップ:`));
    console.log(`  1. ${chalk.cyan(`data/ukiyoe/videos/${jobId}.mp4`)} を再生確認`);
    console.log(`  2. ${chalk.cyan(`${paths.root}/meta-draft.md`)} を確認・編集（必要なら）`);
    console.log(`  3. ${chalk.cyan(`pnpm ukiyoe-ship ${jobId}`)} で投稿`);
  });

program
  .command("ukiyoe-ship")
  .description("ukiyoe channel: YouTube 投稿 + topic-pool 自動更新")
  .argument("<jobId>", "ukiyoe-plan/build で確保した jobId")
  .option("--privacy <status>", "公開状態 (public | unlisted | private)")
  .option(
    "--publish-at <iso>",
    "予約投稿の公開時刻 (ISO 8601, 未来時刻。例: 2026-04-30T18:00:00+09:00)",
  )
  .action(async (jobId: string, opts) => {
    setChannel("ukiyoe");

    const args = [
      "--filter",
      "@rekishi/publisher",
      "exec",
      "tsx",
      "src/cli.ts",
      "youtube",
      jobId,
      "--channel",
      "ukiyoe",
    ];
    if (opts.privacy) args.push("--privacy", opts.privacy);
    if (opts.publishAt) args.push("--publish-at", opts.publishAt);
    await spawnPnpm(args);

    // 投稿成功時に upload.json を読んで topic-pool 更新
    const { resolveUkiyoeJobPaths } = await import("./ukiyoe-paths.js");
    const paths = resolveUkiyoeJobPaths(jobId);
    const uploadJson = path.join(paths.root, "upload.json");
    if (!fs.existsSync(uploadJson)) {
      console.log(chalk.yellow(`\n⚠ upload.json が見つかりません: topic-pool 更新をスキップ`));
      return;
    }
    const upload = JSON.parse(fs.readFileSync(uploadJson, "utf-8")) as { url?: string };

    const m = /^ukiyoe-(.+)-\d{4}-\d{2}-\d{2}$/.exec(jobId);
    if (!m) {
      console.log(chalk.yellow(`\n⚠ jobId からslug を抽出できません: ${jobId}`));
      return;
    }
    const slug = m[1]!;

    const { updateTopicStatus } = await import("./ukiyoe-topic-pool.js");
    await updateTopicStatus(slug, "done", jobId, upload.url);
    console.log(chalk.green(`\n✅ topic-pool 更新: ${slug} → done${upload.url ? ` (${upload.url})` : ""}`));
  });

program.parseAsync().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
  process.exit(1);
});
