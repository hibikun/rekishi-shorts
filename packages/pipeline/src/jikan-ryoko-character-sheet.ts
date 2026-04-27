/**
 * jikan-ryoko チャンネルの主役キャラ参照シート生成スクリプト。
 *
 *  1. ヒーローショット (front close-up) を text→image で 1 枚生成
 *  2. そのヒーローショットを参照画像として渡し、別角度を 5 枚生成
 *
 * 出力: data/jikan-ryoko/character/v1/
 *
 *   pnpm --filter @rekishi/pipeline exec tsx src/jikan-ryoko-character-sheet.ts
 */
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import { generateImage } from "./image-generator.js";
import { config } from "./config.js";

const OUT_DIR = path.join(config.paths.repoRoot, "data", "jikan-ryoko", "character", "v3");

const CHARACTER_BASE = `
A 22-year-old East-Asian woman (Japanese / Korean mixed impression)
with the polished, refined "K-pop idol" aesthetic — chic, fashion-forward,
clearly stylized but still grounded and photorealistic.
Skin: luminous K-beauty "glass skin" — dewy, smooth, hydrated, with a soft
inner glow and very subtle blush on the cheeks. Healthy and radiant,
NOT plastic or airbrushed; fine pores still visible up close.
Face: small, well-defined V-line jaw, sharper than average, refined chin,
small face proportion (소얼굴 / koganse). High cheekbones with a soft contour.
Eyes: large, bright dark-brown almond eyes with a clear catchlight,
prominent natural "aegyo-sal" (애교살 / under-eye plump pad),
double eyelids with subtle warm-brown eyeshadow, fluttery long lashes.
Nose: straight, slim bridge, small rounded tip.
Lips: small but plump heart-shape, subtle K-beauty gradient lip
(soft pink in the center, fading at the edges).
Brows: softly arched straight brows in light brown, neat but natural.
Hair: light caramel-brown shoulder-length, gently wavy with face-framing
layers and soft thin "see-through" bangs (시스루뱅), slight inner shine.
Expression: a confident, cool half-smile — chic and self-possessed,
not goofy, not innocent. Looks like she could be in a fashion campaign.
Wearing a fitted cream sleeveless knit top and high-waist brown straight denim.
A thin silver band ring on her LEFT wrist (must be clearly visible).
Photorealistic, shot on Sony A7 IV, 50mm f/1.8, shallow depth of field,
soft natural daylight with a touch of rim light, editorial fashion vibe,
fine film-like skin texture with subtle visible pores.
She should look polished and stylish — like an off-duty K-pop idol or
a young Asian fashion model. NOT a famous person; no celebrity likeness.
`.trim();

const NEGATIVE = `
Avoid: plastic skin, doll-like face, over-smoothed airbrushed look,
heavy CG render, uncanny valley, exaggerated anime eyes,
heavy makeup, cleavage focus, overly sexualized framing,
dirty background clutter.
`.trim();

interface ShotSpec {
  id: string;
  description: string;
  promptExtra: string;
}

const HERO: ShotSpec = {
  id: "01-hero-front",
  description: "Hero shot: front-facing portrait close-up (defines the character)",
  promptExtra: `
Front-facing medium close-up portrait, head and shoulders visible.
Looking directly at the camera with a soft, slightly amused half-smile.
Neutral light beige seamless studio backdrop.
This is the canonical reference image for character identity.
`.trim(),
};

const VARIATIONS: ShotSpec[] = [
  {
    id: "02-three-quarter-smile",
    description: "Three-quarter angle, gentle smile",
    promptExtra: `
Same woman as the reference image, identical face, hair, clothing, and silver
ring on left wrist. Three-quarter angle (turned ~30 degrees right), looking
back at the camera with a gentle natural smile. Same beige studio backdrop.
`.trim(),
  },
  {
    id: "03-side-profile",
    description: "Side profile (defines hair silhouette)",
    promptExtra: `
Same woman as the reference image. Pure side profile, looking off-camera left.
Clearly shows hair silhouette, jawline, and small ear. Same beige backdrop.
`.trim(),
  },
  {
    id: "04-full-body",
    description: "Full body (locks in outfit proportions)",
    promptExtra: `
Same woman as the reference image. Full-body standing pose, slight contrapposto,
both arms relaxed at sides so the LEFT WRIST silver ring is visible.
Cream sleeveless knit top + high-waist brown straight denim + white sneakers.
Same beige seamless studio backdrop, soft natural daylight.
`.trim(),
  },
  {
    id: "05-selfie-angle",
    description: "Selfie-vlog handheld POV (production-style framing)",
    promptExtra: `
Same woman as the reference image. Handheld selfie-vlog framing: she holds her
phone at arm's length and looks into the camera with a slight half-smile.
Her left arm (with silver ring) is partially visible reaching toward the camera.
Outdoor casual setting, soft daylight, very shallow depth of field, slight
handheld jitter feel. Vertical 9:16 vlog aesthetic.
`.trim(),
  },
  {
    id: "06-left-wrist-detail",
    description: "Left wrist close-up (locks in the silver ring marker)",
    promptExtra: `
Same woman as the reference image. Close-up of her LEFT wrist and hand,
clearly showing the thin silver band ring. Soft daylight, neutral background.
This is a marker reference: the silver ring shape must be unambiguous.
`.trim(),
  },
];

async function ensureOutDir(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

function buildPrompt(spec: ShotSpec): string {
  return [CHARACTER_BASE, "", spec.promptExtra, "", NEGATIVE].join("\n");
}

async function main(): Promise<void> {
  await ensureOutDir();

  console.log(chalk.bold.cyan("\n=== jikan-ryoko character sheet v1 ===\n"));
  console.log(chalk.gray(`Output dir: ${OUT_DIR}\n`));

  // 1) ヒーローショット
  const heroPath = path.join(OUT_DIR, `${HERO.id}.png`);
  console.log(chalk.yellow(`[1/${1 + VARIATIONS.length}] ${HERO.description}`));
  console.log(chalk.gray(`  → ${heroPath}`));
  await generateImage(buildPrompt(HERO), heroPath);
  console.log(chalk.green(`  ✓ done\n`));

  // 2) 別角度（ヒーローショットを参照画像として渡す）
  for (let i = 0; i < VARIATIONS.length; i++) {
    const spec = VARIATIONS[i]!;
    const dest = path.join(OUT_DIR, `${spec.id}.png`);
    console.log(
      chalk.yellow(
        `[${i + 2}/${1 + VARIATIONS.length}] ${spec.description}`,
      ),
    );
    console.log(chalk.gray(`  → ${dest}`));
    await generateImage(buildPrompt(spec), dest, {
      referenceImages: [heroPath],
    });
    console.log(chalk.green(`  ✓ done\n`));
  }

  console.log(chalk.bold.green(`\nAll ${1 + VARIATIONS.length} images saved to:`));
  console.log(`  ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(chalk.red("Generation failed:"), err);
  process.exit(1);
});
