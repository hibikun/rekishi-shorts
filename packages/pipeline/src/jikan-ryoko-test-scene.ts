/**
 * jikan-ryoko: 試作 1 シーン用ワンショットスクリプト。
 *
 *  1. Gemini TTS で台詞を WAV 化
 *  2. v2 のセルフィー画像 + WAV を Kling Avatar 2.0 (Standard) に投げる
 *  3. data/jikan-ryoko/test/scene-01.mp4 に保存
 *
 *   pnpm --filter @rekishi/pipeline exec tsx src/jikan-ryoko-test-scene.ts
 *
 * 既存の他チャンネル (rekishi / kosei / ranking / ukiyoe) には一切影響しない。
 * synthesizeNarration() を読み取り専用で利用するのみ。
 */
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import { config } from "./config.js";
import { synthesizeNarration } from "./tts-generator.js";
import { generateKlingAvatarVideo } from "./jikan-ryoko-kling-avatar.js";

const DIALOG = "私は今、1582年の本能寺にいます！めちゃめちゃ燃えてます";

// 若い女性ボイス候補のうち "Leda" (youthful) をデフォルトに。
// 合わなければ "Aoede" (breezy), "Callirrhoe" (easy-going), "Laomedeia" (upbeat) も試す。
const VOICE = process.env.JIKAN_RYOKO_TEST_VOICE ?? "Leda";

const INPUT_IMAGE = path.join(
  config.paths.repoRoot,
  "data",
  "jikan-ryoko",
  "character",
  "v2",
  "05-selfie-angle.png",
);

const OUT_DIR = path.join(config.paths.repoRoot, "data", "jikan-ryoko", "test");

async function ensureFile(p: string, label: string): Promise<void> {
  try {
    await fs.access(p);
  } catch {
    throw new Error(
      `${label} not found: ${p}\n  → run jikan-ryoko-character-sheet.ts first to generate the v2 character set.`,
    );
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold.cyan("\n=== jikan-ryoko test scene 01 ===\n"));
  await ensureFile(INPUT_IMAGE, "input character image");
  await fs.mkdir(OUT_DIR, { recursive: true });

  const narrationPath = path.join(OUT_DIR, "scene-01-narration.wav");
  const videoPath = path.join(OUT_DIR, "scene-01.mp4");

  console.log(chalk.gray(`Image:    ${INPUT_IMAGE}`));
  console.log(chalk.gray(`Voice:    ${VOICE}`));
  console.log(chalk.gray(`Dialog:   ${DIALOG}`));
  console.log(chalk.gray(`Out dir:  ${OUT_DIR}\n`));

  // ---- Step 1: Gemini TTS ----
  console.log(chalk.yellow("[1/2] Gemini TTS で台詞を WAV 化"));
  const tts = await synthesizeNarration(DIALOG, narrationPath, {
    voiceName: VOICE,
    persona: "narrator",
  });
  console.log(
    chalk.green(
      `  ✓ ${narrationPath} (${tts.approxDurationSec.toFixed(2)}s, ${tts.characters} chars)\n`,
    ),
  );

  // ---- Step 2: Kling Avatar 2.0 ----
  console.log(chalk.yellow("[2/2] Kling Avatar 2.0 Standard でリップシンク動画生成"));
  const result = await generateKlingAvatarVideo(
    {
      imagePath: INPUT_IMAGE,
      audioPath: narrationPath,
      tier: "standard",
      log: (m) => console.log(chalk.gray(`    ${m}`)),
    },
    videoPath,
    tts.approxDurationSec,
  );
  console.log(
    chalk.green(
      `  ✓ ${result.videoPath} (${(result.bytes / 1024).toFixed(1)} KB, est. $${result.estimatedUsd.toFixed(3)})\n`,
    ),
  );

  console.log(chalk.bold.green("Done. Open with:"));
  console.log(`  open ${videoPath}\n`);
}

main().catch((err) => {
  console.error(chalk.red("\nTest scene generation failed:"), err);
  process.exit(1);
});
