#!/usr/bin/env node
/**
 * self-motivation チャンネル用の検証 CLI。
 * Web UI を経由せずに各ステップを単体実行できる。
 *
 * 例:
 *   pnpm tsx packages/pipeline/src/self-motivation-cli.ts create --topic "朝活で人生を変える"
 *   pnpm tsx packages/pipeline/src/self-motivation-cli.ts research <jobId>
 *   pnpm tsx packages/pipeline/src/self-motivation-cli.ts script <jobId>
 *   pnpm tsx packages/pipeline/src/self-motivation-cli.ts expand <jobId>
 *   pnpm tsx packages/pipeline/src/self-motivation-cli.ts image <jobId> <sceneId>
 *   pnpm tsx packages/pipeline/src/self-motivation-cli.ts tts <jobId>
 *   pnpm tsx packages/pipeline/src/self-motivation-cli.ts concat <jobId>
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import {
  SelfMotivationTopicSchema,
  type SelfMotivationTopic,
} from "@rekishi/shared";
import { setChannel } from "@rekishi/shared/channel";
import { generateResearch } from "./research-generator.js";
import {
  SELF_MOTIVATION_CHANNEL,
  audioDir,
  concatAudioPath,
  imagesDir,
  renderDir,
  sceneAudioPath,
  sceneImagePath,
  relFromChannelRoot,
} from "./self-motivation-paths.js";
import {
  createJob,
  loadJob,
  readResearchMarkdown,
  readScenesJson,
  readScriptJson,
  readYoutubeTranscript,
  saveJob,
  updateStep,
  writeResearchMarkdown,
  writeScenesJson,
  writeScriptJson,
} from "./self-motivation-job-store.js";
import {
  generateSelfMotivationScript,
  regenerateMethodChapters,
} from "./self-motivation-script-generator.js";
import { expandScriptToScenes } from "./self-motivation-scene-expander.js";
import { generateImagePromptForScene } from "./self-motivation-image-prompt-generator.js";
import { generateLongformImage } from "./self-motivation-image-generator.js";
import { generateSceneTts } from "./self-motivation-tts.js";
import { concatSelfMotivationTts } from "./self-motivation-tts-concat.js";

setChannel(SELF_MOTIVATION_CHANNEL);

const program = new Command();
program.name("self-motivation").description("self-motivation チャンネル CLI");

program
  .command("create")
  .description("新しいジョブを作成して jobId を出力")
  .requiredOption("--topic <title>", "トピック名")
  .option("--subject <subject>", "カテゴリ", "自己啓発")
  .action(async (opts) => {
    const topic: SelfMotivationTopic = SelfMotivationTopicSchema.parse({
      title: opts.topic,
      subject: opts.subject,
    });
    const job = await createJob(topic);
    console.log(chalk.green(`✅ created jobId=${job.id}`));
  });

program
  .command("research <jobId>")
  .description("Gemini + Google Search でリサーチを実行")
  .action(async (jobId) => {
    const job = await loadJob(jobId);
    console.log(chalk.bold(`🔎 research: ${job.topic.title}`));
    const r = await generateResearch(job.topic);
    await writeResearchMarkdown(jobId, r.markdown);
    await updateStep(jobId, "research", {
      status: "done",
      sources: r.sources,
      queries: r.queries,
      model: r.usage.model,
    });
    console.log(
      chalk.green(`✅ research saved (${r.sources.length} sources)`),
    );
  });

program
  .command("script <jobId>")
  .description("リサーチを元に章立て台本を生成")
  .action(async (jobId) => {
    const job = await loadJob(jobId);
    const md = await readResearchMarkdown(jobId);
    if (!md.trim()) {
      throw new Error("research.md が空。先に research を実行してください");
    }
    console.log(chalk.bold(`📝 script: ${job.topic.title}`));
    const r = await generateSelfMotivationScript(job.topic, md);
    await writeScriptJson(jobId, r.script);
    await updateStep(jobId, "script", {
      status: "done",
      model: r.usage.model,
      estimatedDurationSec: r.script.estimatedDurationSec,
    });
    console.log(
      chalk.green(
        `✅ script saved (chapters=${r.script.chapters.length}, est=${r.script.estimatedDurationSec}s)`,
      ),
    );
  });

program
  .command("regenerate-chapters <jobId>")
  .description(
    "Method-Teaching 章のみを再生成 (第 1 章 / フック / CTA は触らない)。--from と --to は 1-indexed",
  )
  .requiredOption("--from <n>", "再生成を始める章番号 (1-indexed、第 2 章なら 2)")
  .requiredOption("--to <n>", "再生成を終える章番号 (含む)")
  .action(async (jobId, opts) => {
    const fromIndex = Number(opts.from) - 1;
    const toIndex = Number(opts.to) - 1;
    if (Number.isNaN(fromIndex) || Number.isNaN(toIndex)) {
      throw new Error("--from / --to は数字で指定してください");
    }
    const script = await readScriptJson(jobId);
    if (!script) throw new Error("script.json がない");
    const md = await readResearchMarkdown(jobId);
    const job = await loadJob(jobId);
    const transcripts = job.steps.research.youtubeRefs ?? [];
    const youtubeRefs = await Promise.all(
      transcripts
        .filter((r) => r.status === "done")
        .map(async (r) => ({
          videoId: r.videoId,
          url: r.url,
          title: r.title,
          note: r.note,
          markdown: await readYoutubeTranscript(jobId, r.videoId),
        })),
    );

    console.log(
      chalk.bold(
        `🔄 regenerate chapters ${fromIndex + 1}〜${toIndex + 1} of ${script.chapters.length}: ${job.topic.title}`,
      ),
    );
    const result = await regenerateMethodChapters({
      existingScript: script,
      fromIndex,
      toIndex,
      researchMd: md,
      youtubeRefs: youtubeRefs.filter((r) => r.markdown.trim().length > 0),
    });
    await writeScriptJson(jobId, result.script);
    console.log(
      chalk.green(
        `✅ regenerated ${result.regenerated.length} chapters (model=${result.usage.model}, out=${result.usage.outputTokens} tok)`,
      ),
    );
    result.regenerated.forEach((c, i) => {
      const total = c.narrationParagraphs.reduce((s, p) => s + p.length, 0);
      console.log(
        chalk.dim(
          `  ${fromIndex + i + 1}: ${c.title} (${c.narrationParagraphs.length}段落, ${total}字)`,
        ),
      );
    });
  });

program
  .command("expand <jobId>")
  .description("台本を句読点ベースでシーン展開")
  .action(async (jobId) => {
    const script = await readScriptJson(jobId);
    if (!script) throw new Error("script.json がない。先に script を実行");
    const scenes = expandScriptToScenes(script);
    await writeScenesJson(jobId, scenes);
    await updateStep(jobId, "scenes", { status: "done" });
    console.log(chalk.green(`✅ expanded into ${scenes.length} scenes`));
  });

program
  .command("image <jobId> [sceneId]")
  .description("シーンの画像を生成（sceneId 省略時は全シーン）")
  .option("--user <direction>", "画像のユーザー指示（任意）", "")
  .action(async (jobId, sceneId, opts) => {
    const job = await loadJob(jobId);
    const script = await readScriptJson(jobId);
    const scenes = await readScenesJson(jobId);
    if (!script || !scenes) {
      throw new Error("script.json / scenes.json が無い。先に expand 実行");
    }
    await mkdir(imagesDir(jobId), { recursive: true });

    const targets = sceneId
      ? scenes.filter((s) => s.sceneId === sceneId)
      : scenes;
    if (targets.length === 0) throw new Error("対象シーンが無い");

    const updated = [...scenes];
    for (const scene of targets) {
      console.log(chalk.dim(`  scene ${scene.index} (${scene.sceneId})`));
      const promptResult = await generateImagePromptForScene(
        scene,
        script,
        job.topic,
        opts.user,
      );
      const dest = sceneImagePath(jobId, scene.sceneId);
      await generateLongformImage(promptResult.imagePromptEn, dest);
      const idx = updated.findIndex((s) => s.sceneId === scene.sceneId);
      if (idx >= 0) {
        updated[idx] = {
          ...updated[idx]!,
          imagePromptEn: promptResult.imagePromptEn,
          imagePath: relFromChannelRoot(dest),
          imageGeneratedAt: new Date().toISOString(),
        };
      }
    }
    await writeScenesJson(jobId, updated);
    if (!sceneId) await updateStep(jobId, "images", { status: "done" });
    console.log(chalk.green(`✅ generated ${targets.length} image(s)`));
  });

program
  .command("tts <jobId>")
  .description("各シーンの TTS wav を生成")
  .action(async (jobId) => {
    const scenes = await readScenesJson(jobId);
    const script = await readScriptJson(jobId);
    if (!scenes || !script) throw new Error("scenes/script が必要");
    await mkdir(audioDir(jobId), { recursive: true });

    const readingsRecord: Record<string, string> = {};
    for (const r of script.readings ?? []) {
      if (r.term && r.reading) readingsRecord[r.term] = r.reading;
    }

    const updated = [...scenes];
    for (const scene of scenes) {
      console.log(chalk.dim(`  scene ${scene.index} (${scene.sceneId})`));
      const dest = sceneAudioPath(jobId, scene.sceneId);
      const r = await generateSceneTts({
        text: scene.narration,
        destPath: dest,
        readings: readingsRecord,
      });
      const idx = updated.findIndex((s) => s.sceneId === scene.sceneId);
      if (idx >= 0) {
        updated[idx] = {
          ...updated[idx]!,
          audioPath: relFromChannelRoot(dest),
          audioDurationSec: r.durationSec,
          audioGeneratedAt: new Date().toISOString(),
        };
      }
    }
    await writeScenesJson(jobId, updated);
    await updateStep(jobId, "tts", { status: "done" });
    console.log(chalk.green(`✅ generated ${scenes.length} TTS file(s)`));
  });

program
  .command("concat <jobId>")
  .description("全シーン wav を 1 本に結合")
  .action(async (jobId) => {
    const scenes = await readScenesJson(jobId);
    if (!scenes) throw new Error("scenes が必要");
    const inputs = scenes
      .filter((s) => s.audioPath)
      .map((s) => ({
        sceneId: s.sceneId,
        audioPath: path.join(
          path.dirname(audioDir(jobId)),
          "audio",
          `${s.sceneId}.wav`,
        ),
      }));
    if (inputs.length === 0) throw new Error("音声がまだ生成されていない");
    const out = concatAudioPath(jobId);
    const r = await concatSelfMotivationTts(inputs, out);
    await updateStep(jobId, "tts", {
      concatAudioPath: relFromChannelRoot(out),
      concatDurationSec: r.totalDurationSec,
      concatGeneratedAt: new Date().toISOString(),
    });
    console.log(
      chalk.green(`✅ concatenated ${inputs.length} files (${r.totalDurationSec.toFixed(1)}s)`),
    );
  });

program
  .command("status <jobId>")
  .description("ジョブの全ステップ状態を表示")
  .action(async (jobId) => {
    const job = await loadJob(jobId);
    console.log(chalk.bold(`Job: ${job.id}`));
    console.log(chalk.dim(`Topic: ${job.topic.title}`));
    for (const [k, v] of Object.entries(job.steps)) {
      const status = (v as { status: string }).status;
      const icon =
        status === "done"
          ? chalk.green("✓")
          : status === "in-progress"
            ? chalk.yellow("…")
            : status === "error"
              ? chalk.red("✗")
              : chalk.dim("·");
      console.log(`  ${icon} ${k.padEnd(10)} ${status}`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});

// 未使用 import の警告抑止用に saveJob を re-export
export { saveJob, renderDir };
