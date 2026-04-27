/**
 * jikan-ryoko: 試作シーン「燃える本能寺で自撮りする女子」をフルに生成する。
 *
 *  Step 1: Nano Banana で v2 セルフィー画像を参照に「燃える本能寺セルフィー」起点画像を生成
 *  Step 2: Seedance 2.0 fast (image-to-video, native audio) で動画化
 *          → 背景の炎・煙が動き、キャラが台詞を喋る (リップシンク含む) 5 秒動画
 *
 *   pnpm --filter @rekishi/pipeline exec tsx src/jikan-ryoko-honnoji-scene.ts
 *
 * 既存チャンネル (rekishi / kosei / ranking / ukiyoe) には一切影響しない。
 */
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import { config } from "./config.js";
import { generateImage } from "./image-generator.js";
import { generateSeedanceVideo } from "./jikan-ryoko-seedance.js";

const DIALOG = "私は今、1582年の本能寺にいます！めちゃめちゃ燃えてます";

const REFERENCE_IMAGE = path.join(
  config.paths.repoRoot,
  "data",
  "jikan-ryoko",
  "character",
  "v2",
  "05-selfie-angle.png",
);

const OUT_DIR = path.join(config.paths.repoRoot, "data", "jikan-ryoko", "test");

// ---- Step 1 プロンプト: Nano Banana ----------------------------------------
const SCENE_IMAGE_PROMPT = `
Same woman as the reference image — 22-year-old Japanese, light brown wavy
shoulder-length hair, cream sleeveless knit top, high-waist brown straight
denim, thin silver band ring on her LEFT wrist. Identical face, identical
outfit and styling. NOT a different person.

Handheld selfie vlog framing: medium close-up, slight low angle,
her LEFT arm extended toward the camera holding a smartphone
(only the arm partially visible at the edge of the frame).

Setting: INSIDE the burning Honnoji Temple, Kyoto, late at night, June 1582.
Behind her: traditional Japanese wooden temple architecture engulfed in
roaring orange and red flames. Smoke billows through the wooden corridor.
Glowing embers float through the air. Burning paper screens (shoji) collapse
in the background. Wooden beams glow with fire.

Lighting: warm orange firelight illuminating her face from behind, casting
dramatic shadows. Strong rim light on her hair from the flames. Cinematic
atmosphere, hyper-realistic.

Her expression: a half-shocked, half-amused vlogger reaction —
mouth slightly parted as if mid-sentence, eyebrows raised,
looking directly into the phone camera. Modern casual demeanor in absurd
contrast to the historical disaster around her.

9:16 vertical phone-camera frame, photorealistic.
`.trim();

// ---- Step 2 プロンプト: Seedance 2.0 ---------------------------------------
// Chloe フォーマットの呪文 "handheld selfie, hyper-realistic, cinematic atmosphere"
// と、台詞を She says: "..." 形式で含める。日本語 phoneme リップシンク対応想定。
const VIDEO_PROMPT = `
Handheld selfie vlog. The young Japanese woman speaks directly into her phone
camera with a startled-but-trying-to-stay-cool tone, in Japanese:

She says: "${DIALOG}"

Behind her, the wooden Honnoji temple actively burns — flames flicker and
roar dynamically, thick smoke drifts through the corridor in real time,
glowing embers float past her face. Her hair sways gently from the rising
heat updraft. Subtle natural handheld camera jitter throughout, as if she
is genuinely filming a vlog mid-emergency.

Audio: her clear Japanese voice in the foreground, crackling fire and
distant wood collapsing as ambient background sound.

Handheld selfie, hyper-realistic, cinematic atmosphere.
`.trim();

async function ensureFile(p: string, label: string): Promise<void> {
  try {
    await fs.access(p);
  } catch {
    throw new Error(
      `${label} not found: ${p}\n  → run jikan-ryoko-character-sheet.ts first to generate v2.`,
    );
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold.cyan("\n=== jikan-ryoko: Honnoji scene (Seedance 2.0 fast) ===\n"));
  await ensureFile(REFERENCE_IMAGE, "v2 reference image");
  await fs.mkdir(OUT_DIR, { recursive: true });

  const sourceImagePath = path.join(OUT_DIR, "scene-02-source.png");
  const videoPath = path.join(OUT_DIR, "scene-02.mp4");

  console.log(chalk.gray(`Reference: ${REFERENCE_IMAGE}`));
  console.log(chalk.gray(`Dialog:    ${DIALOG}`));
  console.log(chalk.gray(`Out dir:   ${OUT_DIR}\n`));

  // ---- Step 1: Nano Banana で起点画像 ----
  console.log(chalk.yellow("[1/2] Nano Banana で「燃える本能寺セルフィー」起点画像を生成"));
  console.log(chalk.gray(`  → ${sourceImagePath}`));
  await generateImage(SCENE_IMAGE_PROMPT, sourceImagePath, {
    referenceImages: [REFERENCE_IMAGE],
  });
  console.log(chalk.green(`  ✓ 起点画像生成完了\n`));

  // ---- Step 2: Seedance 2.0 fast で動画化 ----
  console.log(
    chalk.yellow("[2/2] Seedance 2.0 fast で動画化 (動き + 台詞 + リップシンク + 音声)"),
  );
  const result = await generateSeedanceVideo(
    {
      imagePath: sourceImagePath,
      prompt: VIDEO_PROMPT,
      tier: "standard",
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
  console.error(chalk.red("\nHonnoji scene generation failed:"), err?.message ?? err);
  if (err?.body) {
    console.error(chalk.red("Body:"), JSON.stringify(err.body, null, 2));
  }
  process.exit(1);
});
