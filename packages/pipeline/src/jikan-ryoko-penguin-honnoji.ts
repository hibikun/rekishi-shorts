/**
 * jikan-ryoko: ゆるキャラ版試作 — ペンギンが本能寺で自撮り。
 *
 * 目的: Seedance 2.0 の "real people likeness" content filter は写実的な人物に対するもの。
 *       ゆるキャラ (clearly stylized, non-human) なら通るはず、を検証する。
 *
 * フロー:
 *   Step 0: ペンギンキャラのヒーローショット生成 (Nano Banana, text-only)
 *   Step 1: ヒーローショットを参照に「燃える本能寺で自撮りするペンギン」起点画像
 *   Step 2: Seedance 2.0 fast で動画化 (動き + 台詞 + リップシンク + 音声)
 *
 *   pnpm --filter @rekishi/pipeline exec tsx src/jikan-ryoko-penguin-honnoji.ts
 */
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import { config } from "./config.js";
import { generateImage } from "./image-generator.js";
import { generateSeedanceVideo } from "./jikan-ryoko-seedance.js";

const DIALOG = "ぼく今、1582年の本能寺にいるんだけど、めちゃめちゃ燃えてる";

const OUT_DIR = path.join(config.paths.repoRoot, "data", "jikan-ryoko", "test", "penguin");

// ---- Step 0: ペンギンキャラ仕様 ---------------------------------------------
// 「明らかに非実在のゆるキャラ」であることを強調。
// 固有マーカーは赤いマフラー (人間版の silver ring に相当)。
const PENGUIN_HERO_PROMPT = `
A cute, chubby cartoon penguin mascot character — clearly stylized 3D
animated character, NOT photorealistic, NOT a real animal photo.

Body: round chubby penguin with shiny midnight-blue feathers on the back
and a creamy white belly. Small flippers (arm-like) that can hold objects.
Standing upright on small orange webbed feet.

Face: big round expressive shiny eyes with bright highlights, small
upward-curved mouth (like a smile), a small bright orange beak.
Friendly, slightly mischievous expression.

Distinctive marker (must always be present): a small bright RED knitted
SCARF wrapped twice around its neck, with the loose ends hanging down.

Style: warm, soft Pixar-meets-anime stylization. Soft shading, gentle rim
light, slightly oversized head for cuteness. Clearly a fictional mascot.

Setting: simple soft beige studio backdrop, soft natural light.
Centered, full body, facing camera. 9:16 vertical.
`.trim();

// ---- Step 1: 燃える本能寺シーン (ヒーロー参照) ------------------------------
const PENGUIN_HONNOJI_PROMPT = `
Same penguin mascot character as the reference image — chubby, midnight-blue
back, white belly, big round shiny eyes, small orange beak, RED knitted
scarf around its neck. Identical character, same stylized cartoon look.

Pose: standing on its small orange feet INSIDE the burning Honnoji Temple,
Kyoto, late at night, June 1582. The penguin is holding a smartphone with
its left flipper, extending it forward like a vlogger taking a selfie.
Only the flipper holding the phone is partially visible at the edge of frame.

Behind the penguin: traditional Japanese wooden temple architecture engulfed
in roaring orange and red flames. Smoke billows through the wooden corridor.
Glowing embers float through the air. Burning paper screens (shoji) collapse
in the background. Wooden beams glow with fire.

Lighting: warm orange firelight illuminating the penguin from behind,
casting dramatic shadows. Cinematic atmosphere.

Penguin's expression: a slightly worried but trying-to-stay-cool vlogger
look — beak slightly open as if mid-sentence, eyes wide. Cute mascot
demeanor in absurd contrast to the historical disaster around it.

Stylized cartoon mascot in a hyper-realistic burning environment.
Mixed-media look: cartoon character + photoreal background, like a cinematic
animated short. 9:16 vertical phone-camera frame.
`.trim();

// ---- Step 2: Seedance プロンプト --------------------------------------------
const VIDEO_PROMPT = `
Handheld selfie vlog. The cute cartoon penguin mascot speaks directly into
its phone camera with a startled-but-trying-to-stay-cool tone, in Japanese:

It says: "${DIALOG}"

Behind the penguin, the wooden Honnoji temple actively burns — flames
flicker and roar dynamically, thick smoke drifts through the corridor in
real time, glowing embers float past the penguin. Its red scarf flutters
gently from the rising heat updraft. The penguin's beak opens and closes
in sync with its words. Subtle natural handheld camera jitter.

Audio: a cute, slightly-high-pitched friendly Japanese voice in the
foreground, crackling fire and distant wood collapsing as ambient
background sound.

Handheld selfie, hyper-realistic background, cinematic atmosphere,
stylized cartoon character.
`.trim();

async function main(): Promise<void> {
  console.log(chalk.bold.cyan("\n=== jikan-ryoko: penguin Honnoji test ===\n"));
  await fs.mkdir(OUT_DIR, { recursive: true });

  const heroPath = path.join(OUT_DIR, "00-penguin-hero.png");
  const sourcePath = path.join(OUT_DIR, "01-penguin-honnoji-source.png");
  const videoPath = path.join(OUT_DIR, "02-penguin-honnoji.mp4");

  console.log(chalk.gray(`Out dir:  ${OUT_DIR}`));
  console.log(chalk.gray(`Dialog:   ${DIALOG}\n`));

  // ---- Step 0: ペンギンヒーロー ----
  console.log(chalk.yellow("[0/2] Nano Banana でペンギンのヒーローショット生成"));
  console.log(chalk.gray(`  → ${heroPath}`));
  await generateImage(PENGUIN_HERO_PROMPT, heroPath);
  console.log(chalk.green(`  ✓\n`));

  // ---- Step 1: 燃える本能寺ペンギン ----
  console.log(chalk.yellow("[1/2] Nano Banana で「燃える本能寺セルフィーペンギン」起点画像"));
  console.log(chalk.gray(`  → ${sourcePath}`));
  await generateImage(PENGUIN_HONNOJI_PROMPT, sourcePath, {
    referenceImages: [heroPath],
  });
  console.log(chalk.green(`  ✓\n`));

  // ---- Step 2: Seedance 2.0 fast ----
  console.log(
    chalk.yellow("[2/2] Seedance 2.0 fast で動画化 (動き + 台詞 + リップシンク + 音声)"),
  );
  const result = await generateSeedanceVideo(
    {
      imagePath: sourcePath,
      prompt: VIDEO_PROMPT,
      tier: "fast",
      duration: 5,
      resolution: "720p",
      aspectRatio: "9:16",
      generateAudio: true,
      log: (m) => console.log(chalk.gray(`    ${m}`)),
    },
    videoPath,
  );
  console.log(
    chalk.green(
      `  ✓ ${result.videoPath} (${(result.bytes / 1024).toFixed(1)} KB, ${result.durationSec}s, est. $${result.estimatedUsd.toFixed(3)})\n`,
    ),
  );

  console.log(chalk.bold.green("Done. Open with:"));
  console.log(`  open ${videoPath}\n`);
}

main().catch((err) => {
  console.error(chalk.red("\nPenguin Honnoji generation failed:"), err?.message ?? err);
  if (err?.body) {
    console.error(chalk.red("Body:"), JSON.stringify(err.body, null, 2));
  }
  process.exit(1);
});
