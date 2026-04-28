/**
 * 学びラボ 動画001「ノートまとめは時間の無駄」用の B-roll 画像を生成。
 *
 * シーン割り振り (docs/scene-plan-001-note-matome.md) で必要とされた、
 * キャラ非依存の B-roll 静止画 2 枚を作る。
 *
 * 出力: packages/channels/manabilab/assets/brolls/v1/
 *
 * 実行:
 *   pnpm --filter @rekishi/pipeline exec tsx src/manabilab-video-001-brolls.ts
 *   pnpm --filter @rekishi/pipeline exec tsx src/manabilab-video-001-brolls.ts --force
 */
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import { generateImage } from "./image-generator.js";
import { config } from "./config.js";

const OUT_DIR = path.join(
  config.paths.repoRoot,
  "packages",
  "channels",
  "manabilab",
  "assets",
  "brolls",
  "v1",
);

interface ShotSpec {
  id: string;
  description: string;
  prompt: string;
  vertical?: boolean;
}

const SHOTS: ShotSpec[] = [
  {
    id: "broll-01-discarded-markers",
    description: "scene 2: ゴミ箱に投げ捨てられた使用済み黄色マーカー＋砂時計（時間の無駄の象徴）",
    prompt: `
A flat 2D vector illustration showing a pile of USED yellow highlighter pens dumped
into and around a cartoon trash can. Some highlighters lie on the ground beside the
trash can, looking exhausted (some have caps off, some are spilling).
Next to the trash can on the ground is a small cute PINK HOURGLASS with most of the
sand having already fallen to the bottom (signifying "wasted time").

Visual style:
- 2D vector illustration, flat colors with subtle 1-2 tone cel-shading.
- Bold smooth line art at consistent ~3px line weight, in dark warm pink/burgundy
  (NOT pure black). Same aesthetic family as a friendly fitness mascot brand.
- Background: light neutral gray (#F0F0F0) seamless backdrop, slight floor shadow
  under the trash can.
- Color palette: yellow highlighters (warm yellow, dark yellow shadows), gray trash
  can with pink accent, pink hourglass, light gray backdrop. Should harmonize with
  a pink-themed brand world.
- Composition: trash can slightly off-center, hourglass in foreground left, slight
  diagonal energy.
- NO text, NO labels, NO captions.
- NO characters or hands or people in the frame.
- Reminiscent of a contemporary YouTube fitness/learning channel B-roll illustration.
- NOT photorealistic. NOT anime. NOT 3D-rendered.

Mood: comedic, "wasted effort being thrown away".
`.trim(),
    vertical: true,
  },
  {
    id: "broll-02-ebbinghaus-vintage",
    description: "scene 10: エビングハウスの19世紀風肖像＋セピアの古い研究ノート（100年以上前を象徴）",
    prompt: `
A vintage 19th-century scientific composition. Two elements arranged in the frame:

LEFT (or upper portion): A black-and-white pencil-sketch / engraved-portrait style
illustration of a fictional 19th-century European male scholar (NOT a specific real
person — generic look). He has a serious expression, a neatly trimmed full beard,
spectacles, and is wearing a high-collar Victorian shirt with a dark coat.
Style: classic stippled portrait engraving like an old encyclopedia plate,
monochromatic with subtle warm sepia tint.

RIGHT (or lower portion): An aged sepia-colored piece of parchment / yellowed
notebook paper, slightly crumpled, with HAND-DRAWN ink curves clearly showing
the FORGETTING CURVE — a classic exponential decay curve dropping sharply from
left to right, with a horizontal axis labeled "Days" (or untranslated symbols)
and vertical axis labeled "Memory %". Small handwritten numerical annotations
along the curve in faded ink. The whole paper has the texture of old paper:
brown spots, slightly torn edges, the ink is faded brown.

Background: a neutral muted dark backdrop (deep brown or aged paper texture)
that lets the two elements stand out.

Visual style:
- Intentionally NOT cartoon. This shot deliberately breaks from the channel's
  flat-vector style to give a "historical archive" feeling.
- Daguerreotype / engraving aesthetic + aged parchment.
- Sepia, warm grays, muted browns. NO bright colors.
- NO modern type or English captions visible. Optionally a small handwritten
  year like "1885" on the paper, but kept minimal and faded.
- NO photorealistic skin (sketchy engraving look only).
- NO modern objects.

Mood: gravitas, "this knowledge has been proven for over a century".
`.trim(),
    vertical: true,
  },
];

async function ensureOutDir(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await ensureOutDir();

  const force = process.argv.includes("--force");

  console.log(chalk.bold.magenta("\n=== manabilab video-001 B-rolls ===\n"));
  console.log(chalk.gray(`Output dir: ${OUT_DIR}`));
  console.log(chalk.gray(force ? "Mode: --force (overwrite all)\n" : "Mode: skip-if-exists\n"));

  for (let i = 0; i < SHOTS.length; i++) {
    const spec = SHOTS[i]!;
    const dest = path.join(OUT_DIR, `${spec.id}.png`);
    const num = `[${i + 1}/${SHOTS.length}]`;
    if (!force && (await fileExists(dest))) {
      console.log(chalk.gray(`${num} ${spec.description}`));
      console.log(chalk.gray(`  ⏭  skip (already exists)\n`));
      continue;
    }
    console.log(chalk.yellow(`${num} ${spec.description}`));
    console.log(chalk.gray(`  → ${dest}`));
    await generateImage(spec.prompt, dest, {
      appendAspectSuffix: spec.vertical ?? true,
    });
    console.log(chalk.green(`  ✓ done\n`));
  }

  console.log(chalk.bold.green(`\nDone. ${SHOTS.length} B-roll shots in:`));
  console.log(`  ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(chalk.red("Generation failed:"), err);
  process.exit(1);
});
