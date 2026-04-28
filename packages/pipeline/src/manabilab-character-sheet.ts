/**
 * 学びラボ (manabilab) のメインキャラクター参照シート生成スクリプト。
 *
 * コンセプト: ピンク色の "脳が頭" マッチョキャラ（Bro Pump 構造へのオマージュ + 学習科学の差別化）。
 * Bro Pump 風の faceless minimalism を踏襲しつつ、頭部を脳形状にすることで
 * "脳もまた筋肉だ" という学習科学チャンネルのテーマを1秒で伝える。
 *
 * フロー:
 *   1. ヒーローショット (front, neutral standing) を text→image で 1 枚
 *   2. ヒーローを参照画像として渡し、別ポーズを 4 枚生成
 *
 * 出力: packages/channels/manabilab/assets/character/v1/ （コミット対象）
 *
 * 実行:
 *   pnpm --filter @rekishi/pipeline exec tsx src/manabilab-character-sheet.ts
 *
 * 既存ファイルがある場合は上書きされるので注意。
 * v2 など別バージョンを試す場合は OUT_DIR の v1 を v2 に差し替えること。
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
  "character",
  "v1",
);

const CHARACTER_BASE = `
A muscular cartoon mascot character for a "learning science / cognitive science" YouTube
Shorts channel. The character must be EXACTLY as described — every element matters for
brand consistency.

HEAD (most important):
- The HEAD IS A STYLIZED BRAIN. The brain shape IS the head — there is no skull,
  no hair, no neck-to-jaw transition. The brain sits directly on the neck.
- Brain color: light/medium PINK (#FFB6C1 ~ #FF99B0 range), slightly LIGHTER than the body.
- Brain has soft, smooth, cute gyri (the squiggly folds), in a slightly DARKER pink.
  The folds are stylized and friendly, NOT anatomical, NOT gory, NOT realistic.
- Brain front (where a forehead would be) has a SMALL WHITE DUMBBELL ICON,
  flat and simple, like a stamped logo. About the size of one of the eyes.
- TWO SIMPLE WHITE OVAL DOTS for eyes, evenly spaced on the lower-front of the brain,
  where eyes would be on a face. NO mouth. NO nose. NO eyebrows. NO other facial features.
- The expression is conveyed only through the eye dots and brain-glow.

BODY:
- Muscular, athletic, heroic-cartoon proportions: defined pecs, six-pack abs,
  broad shoulders, visible biceps and triceps. Slightly stylized (NOT bodybuilder
  grotesque, NOT chibi, NOT skinny).
- Body skin tone: SATURATED CORAL / SALMON PINK (#F08080 ~ #FF7B9C range).
  Slightly DARKER than the brain head so they read as separate components.
- Wearing knee-length workout shorts in DEEP MAGENTA / HOT PINK (#D63384 ~ #E91E63),
  with a small white drawstring at the waist.
- Bare feet, clean and stylized.

VISUAL STYLE:
- 2D vector illustration. Flat colors with subtle 1-2 tone cel-shading
  (slightly darker pink for shadows on muscles).
- Bold, smooth line art at consistent ~3px line weight, in dark warm pink/burgundy
  (NOT pure black).
- Background: light neutral gray (#F0F0F0) seamless backdrop, NO objects, NO floor line.
- Aesthetic reference: contemporary YouTube fitness mascot style (Bro Pump, etc.)
  but reinterpreted for the learning/cognition niche via the brain head.

MOOD:
- Friendly, confident, energetic, slightly comedic. Looks like it's "having fun
  training the brain like a muscle".
`.trim();

const NEGATIVE = `
ABSOLUTELY AVOID:
- Realistic anatomy (no actual skull, no exposed flesh, no blood, no veins)
- Gore, body horror, creepy, uncanny
- Any face features beyond the two white eye-dots (NO mouth, NO nose, NO eyebrows, NO ears)
- Hair on the brain
- Text, captions, labels, watermarks, signatures
- Background props, scenery, floor lines, shadows on the floor
- Other characters, other people
- Photorealistic rendering
- 3D rendering / pre-rendered CGI look
- Anime style with sparkly eyes
- Chibi / super-deformed proportions
- Sexual / over-suggestive framing
`.trim();

interface ShotSpec {
  id: string;
  description: string;
  promptExtra: string;
  /** 9:16 縦長を付けるか。キャラシートは 1:1 で良いので false にする shot もある。 */
  vertical?: boolean;
}

const HERO: ShotSpec = {
  id: "01-hero-front-standing",
  description: "Hero shot: full-body front-facing neutral standing pose (defines the character)",
  promptExtra: `
Pose: full-body, front-facing, standing upright in a relaxed but confident neutral pose.
Both arms hanging naturally at the sides, slightly away from the body so the arm muscles
are clearly visible. Feet shoulder-width apart. Looking straight at the camera with the
two white eye-dots positioned symmetrically. The dumbbell icon on the brain is clearly
visible front-and-center. Light gray seamless backdrop. This is the canonical reference
image for character identity — every other shot must match this character exactly.
`.trim(),
  vertical: true,
};

const VARIATIONS: ShotSpec[] = [
  {
    id: "02-bench-press",
    description: "Bench press — Bro Pump homage, signature 'training the brain' pose",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head with white dumbbell
icon and two white eye-dots, IDENTICAL coral pink muscular body, IDENTICAL deep magenta
shorts.
Pose: lying on a flat workout bench, doing a barbell bench press. Both arms extended
upward, gripping a black barbell with circular weight plates. Front view, the brain
head is tilted slightly back as if straining slightly. Arm and chest muscles flexed
and clearly defined. Light gray seamless backdrop. This pose is the manabilab signature
"training the brain like a muscle" cover-shot.
`.trim(),
    vertical: true,
  },
  {
    id: "03-wrong-way-highlighting",
    description: "HOOK scene material: frantically highlighting a textbook (the WRONG way to study)",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head, IDENTICAL coral pink
muscular body, IDENTICAL deep magenta shorts.
Pose: sitting at a small desk, hunched over a thick open textbook. Holding a bright
yellow highlighter in one hand, frantically scribbling/highlighting nearly the ENTIRE
page yellow (so much yellow it looks absurd). The two white eye-dots are slightly
narrowed (squinting from over-focus). Tiny sweat-drop sparkle near the brain to suggest
exhaustion. Composition: 3/4 angle, slight downward camera angle. Light gray backdrop,
just the desk and book are visible (no other objects).
This shot is for HOOK scenes that show "the wrong study method that everyone does".
`.trim(),
    vertical: true,
  },
  {
    id: "04-recall-practice-glow",
    description: "Method 1 scene material: 想起練習 (eyes closed, brain glowing during recall)",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head, IDENTICAL coral pink
muscular body, IDENTICAL deep magenta shorts.
Pose: sitting cross-legged in lotus position. A CLOSED textbook rests in the lap.
The two white eye-dots are CLOSED — represented as two small horizontal lines or
crescents (eyes-closed look). The brain head is GLOWING with a soft pink/white halo
around it (subtle, like an aura), suggesting active recall happening inside.
Calm, focused expression. Light gray backdrop, no other objects.
This shot is for Method 1 scenes about active recall / retrieval practice.
`.trim(),
    vertical: true,
  },
  {
    id: "05-triumph-flex",
    description: "CLOSING scene material: double-bicep triumphant flex with bright brain glow",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head, IDENTICAL coral pink
muscular body, IDENTICAL deep magenta shorts.
Pose: classic double-bicep flex pose (both arms raised at the sides, elbows bent at 90
degrees, fists clenched, biceps maximally flexed). The two white eye-dots look intense
and confident. The brain head glows BRIGHTLY with a vivid pink/white aura — much more
intense than the recall-practice shot, like the brain is at peak performance. Front view.
Light gray backdrop, no other objects.
This shot is for CLOSING scenes where the character has achieved the result.
`.trim(),
    vertical: true,
  },
  {
    id: "06-pointing-two-fingers",
    description: "REFRAME scene material: confidently presenting 'two fingers' (peace sign)",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head, IDENTICAL coral pink
muscular body, IDENTICAL deep magenta shorts.
Pose: bust-up framing (waist up to top of brain). One arm raised confidently, hand
clearly showing a PEACE SIGN / "V" with INDEX and MIDDLE FINGERS extended (the "2"
gesture), other fingers curled into a fist. The other arm relaxed at the side or
on the hip. Slight smile-energy in the two white eye-dots (eye dots themselves are
unchanged simple ovals, but their positioning suggests confidence). The character
faces the camera directly, slight forward lean. Light gray seamless backdrop, no
other objects.
This shot is for REFRAME scenes that say "本当に効く方法は2つしかありません" /
"Here are the only 2 methods". The "2" gesture must be unambiguous and dominant
in the composition.
`.trim(),
    vertical: true,
  },
  {
    id: "07-spread-study-calendar",
    description: "Method 2 (spacing/分散学習) scene material: marking days on a wall calendar",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head, IDENTICAL coral pink
muscular body, IDENTICAL deep magenta shorts.
Pose: standing in 3/4 angle (turned about 30 degrees) facing a large WALL CALENDAR
mounted on the wall behind them. The calendar shows a typical month grid (5 rows x
7 columns of date squares). The character holds a pink marker in their dominant hand,
reaching up to mark THREE different non-consecutive days on the calendar (e.g., 3
checkmarks or 3 small pink dots on Monday/Wednesday/Friday squares — the marks should
be VISIBLE and CLEARLY SPREAD ACROSS DIFFERENT DAYS, not all next to each other).
The body posture suggests "planning / scheduling". The two white eye-dots focus on
the calendar. Light gray seamless backdrop. The wall calendar is the only prop.
This shot is for METHOD 2 (spacing effect / 分散学習) scenes about spreading study
across multiple days. The "spread across days" visual must be unambiguous.
`.trim(),
    vertical: true,
  },
  {
    id: "08-thinking-brain-aura",
    description: "REFRAME 法則アンカー scene material: knowingly touching the brain with confidence",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head, IDENTICAL coral pink
muscular body, IDENTICAL deep magenta shorts.
Pose: bust-up framing (waist up to top of brain). One hand raised gently to TOUCH or
REST FINGERS LIGHTLY ON THE SIDE OF THE BRAIN (just behind where the eye-dot would be),
in a "I know what's happening in here" intellectual gesture. The other arm relaxed at
the side. The two white eye-dots are CLOSED gently (small horizontal lines / crescents)
suggesting calm, knowing confidence. The brain head has a SUBTLE soft pink/cyan glow
aura around it, suggesting "scientific knowledge inside". A few tiny floating circular
synapse-dots (small pink dots) hover gently around the upper sides of the brain to
hint at neural activity. Light gray seamless backdrop, no other objects.
This shot is for REFRAME (法則アンカー) scenes saying "認知科学の法則に従って勉強する"
— it visualizes "the science is inside the brain, follow it".
`.trim(),
    vertical: true,
  },
  {
    id: "09-recalling-with-effort",
    description: "Method 1 開幕 scene material: actively recalling — eyes closed, mouth slightly open speaking out loud",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head, IDENTICAL coral pink
muscular body, IDENTICAL deep magenta shorts.
Pose: bust-up to mid-thigh framing. The character has ONE HAND PRESSED TO THE FOREHEAD
(specifically on the front of the brain near the dumbbell logo) in a classic "I'm
remembering hard" gesture. The other hand is held out slightly forward in an
explanatory/speaking gesture (palm-up, fingers loose). The two white eye-dots are
TIGHTLY CLOSED — represented as small upward-curving crescents (like ^^), expressing
intense focused effort. A small white SPEECH-ICON ACCENT (a tiny "!" or sparkle) hovers
near the brain to suggest a memory just popping out. The brain has a subtle inner-
glow on one specific gyrus area (where memory is being retrieved). The body leans
slightly forward, energetically trying to recall. Light gray seamless backdrop.
This shot is for METHOD 1 開幕 (想起練習 / retrieval practice) — it visualizes
the moment of actively pulling a memory back, with the character speaking out loud.
`.trim(),
    vertical: true,
  },
  {
    id: "10-calendar-overview",
    description: "Method 2 開幕 scene material: presenting the whole calendar concept with arms-spread overview gesture",
    promptExtra: `
Same character as the reference image — IDENTICAL pink brain head, IDENTICAL coral pink
muscular body, IDENTICAL deep magenta shorts.
Pose: full body, front-facing or slight 3/4. The character has BOTH ARMS RAISED OUT
TO THE SIDES at shoulder height in a wide PRESENTING GESTURE, like a game-show host
revealing something behind them. Behind the character (occupying most of the upper
two-thirds of the background), a LARGE WALL CALENDAR is shown — a clean monthly grid
(5 rows x 7 columns), with NO marks on any days yet (it's an empty calendar to
present the concept). The two white eye-dots look directly at the camera with
confident energy. The brain has a soft pink glow. Composition: character in lower
foreground, calendar dominating the back. Light gray seamless backdrop.
This shot is for METHOD 2 開幕 (分散学習 / spaced learning) — it introduces the
calendar concept by presenting the empty grid before the character marks specific days.
Different angle and energy from 07-spread-study-calendar (which is the action of marking).
`.trim(),
    vertical: true,
  },
];

function buildPrompt(spec: ShotSpec): string {
  return [CHARACTER_BASE, "", spec.promptExtra, "", NEGATIVE].join("\n");
}

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

  // CLI フラグ: --force で既存も上書き再生成。デフォルトは存在チェックでスキップ。
  const force = process.argv.includes("--force");

  console.log(chalk.bold.magenta("\n=== manabilab character sheet v1 (pink brain mascot) ===\n"));
  console.log(chalk.gray(`Output dir: ${OUT_DIR}`));
  console.log(chalk.gray(force ? "Mode: --force (overwrite all)\n" : "Mode: skip-if-exists\n"));

  const heroPath = path.join(OUT_DIR, `${HERO.id}.png`);
  if (!force && (await fileExists(heroPath))) {
    console.log(chalk.gray(`[1/${1 + VARIATIONS.length}] ${HERO.description}`));
    console.log(chalk.gray(`  ⏭  skip (already exists)\n`));
  } else {
    console.log(chalk.yellow(`[1/${1 + VARIATIONS.length}] ${HERO.description}`));
    console.log(chalk.gray(`  → ${heroPath}`));
    await generateImage(buildPrompt(HERO), heroPath, {
      appendAspectSuffix: HERO.vertical ?? true,
    });
    console.log(chalk.green(`  ✓ done\n`));
  }

  for (let i = 0; i < VARIATIONS.length; i++) {
    const spec = VARIATIONS[i]!;
    const dest = path.join(OUT_DIR, `${spec.id}.png`);
    const num = `[${i + 2}/${1 + VARIATIONS.length}]`;
    if (!force && (await fileExists(dest))) {
      console.log(chalk.gray(`${num} ${spec.description}`));
      console.log(chalk.gray(`  ⏭  skip (already exists)\n`));
      continue;
    }
    console.log(chalk.yellow(`${num} ${spec.description}`));
    console.log(chalk.gray(`  → ${dest}`));
    await generateImage(buildPrompt(spec), dest, {
      referenceImages: [heroPath],
      appendAspectSuffix: spec.vertical ?? true,
    });
    console.log(chalk.green(`  ✓ done\n`));
  }

  console.log(chalk.bold.green(`\nDone. ${1 + VARIATIONS.length} target shots in:`));
  console.log(`  ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(chalk.red("Generation failed:"), err);
  process.exit(1);
});
