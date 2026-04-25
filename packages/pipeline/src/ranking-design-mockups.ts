import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { channelDataRoot } from "@rekishi/shared/channel";
import { config } from "./config.js";

/**
 * ranking チャンネルの「大人/高級」系スライドショーを設計するためのキービジュアル
 * モックを OpenAI Images API で複数バリエーション生成する。
 *
 * 1枚の縦長 9:16 キャンバスに opening / 第3位 / 第1位+レビュー / closing の
 * 4 シーンを上から積んだモックボードを描かせ、ユーザーが好きな配色/書体/質感を
 * 選んで `RankingShort.tsx` のデザイン更新指針にする。
 */

interface MockupVariant {
  id: string;
  title: string;
  palette: string;
  typography: string;
  feel: string;
  notes?: string;
}

const VARIANTS: MockupVariant[] = [
  {
    id: "01-noir-gold",
    title: "Noir × Warm Gold",
    palette:
      "deep midnight black background with subtle film grain, warm muted gold accents, off-white text. No vivid red, no rainbow.",
    typography:
      "elegant Japanese mincho/serif, generous letter spacing, thin gold hairline rules separating sections.",
    feel: "luxury whisky / Swiss watch advertorial. Mature, restrained, editorial.",
  },
  {
    id: "02-editorial-bone",
    title: "Editorial Bone Paper",
    palette:
      "warm bone / off-white paper background with very subtle fiber texture, charcoal text, single oxblood burgundy accent.",
    typography:
      "high-contrast Japanese serif (mincho) for headlines, ultra-fine modern sans-serif for annotations and small caps labels.",
    feel: "Vogue Japan / Kinfolk magazine spread. Calm, paper-craft, low contrast.",
  },
  {
    id: "03-matte-rosegold",
    title: "Matte Black × Rose Gold",
    palette:
      "matte black with very subtle dark marble texture, soft rose gold metallic accents, ivory text.",
    typography:
      "sleek modern Japanese serif, ample whitespace, hairline metallic frame around product cards.",
    feel: "Tom Ford / Aesop packaging. Sophisticated, tactile, men's grooming.",
  },
  {
    id: "04-library-brass",
    title: "Library Brass",
    palette:
      "deep forest green leather backdrop, antique brass accents, warm cream text. No neon.",
    typography:
      "classic Japanese serif with brass-plate numeral badges for the rank marks, library catalog aesthetic.",
    feel: "private library / atelier showroom. Intellectual, warm, mature gentleman.",
  },
  {
    id: "05-midnight-silver",
    title: "Midnight Minimal",
    palette:
      "midnight blue subtle gradient, brushed silver accents, sand beige tones. Almost monochrome.",
    typography:
      "minimal Japanese serif with extremely wide letter spacing, thin geometric frames, small numerical labels in mono digits.",
    feel: "Muji × Audi. Modern, calm, geometric, restrained.",
  },
  {
    id: "06-mocha-cream",
    title: "Mocha Cream",
    palette:
      "warm beige and ivory background, dark mocha brown text, soft cinnamon and brass accents.",
    typography:
      "rounded mincho with hand-drawn serif details, very subtle watermark patterns in the background.",
    feel: "specialty café / quality bookshop. Warm, inviting, premium yet approachable.",
  },
];

const SHARED_COMPOSITION = `
Create a single vertical 9:16 design mockup BOARD that previews FOUR EQUAL HORIZONTAL PANELS stacked from top to bottom (each panel ≈ 25% of the canvas height) for a Japanese product-ranking short video aimed at men in their late 20s to 30s. ALL FOUR PANELS MUST BE FULLY VISIBLE — do NOT crop or omit any panel. Separate panels with very thin hairline rules and small panel labels at the right edge of each rule ("01 OPENING", "02 RANK #3", "03 RANK #1", "04 CLOSING") in tiny small caps.

Scenes from top to bottom:
1. OPENING — A bold Japanese title hook (use the phrase 「神アイテム3選」 in stylized typography), a small subtitle line such as 「30代男のデスクが捗る」, and a discreet decorative motif. Convey curiosity and premium aesthetic, NOT clickbait.
2. RANK #3 PRODUCT REVEAL — A refined "第3位" rank mark, a tasteful product placeholder (a clean rectangle that suggests a premium gadget — e.g. minimalist charger or grooming tool), brand/category text in small caps below.
3. RANK #1 PRODUCT WITH USER REVIEWS — A prominent "第1位" rank mark, a slightly dimmed product placeholder, and three short Japanese review quotes overlaid as elegant editorial cards (use thin borders and serif quotation marks — NOT cartoon speech bubbles).
4. CLOSING CTA — A short final phrase such as 「今すぐチェック」, a thin-frame call-to-action button, and a small channel mark/logogram.

HARD aesthetic constraints:
- ABSOLUTELY NO bright primary red, NO rainbow gradient text, NO heavy black stroke outlines around large text.
- NO cartoon speech bubbles with thick neon borders (pink, green, purple). Use minimal editorial cards instead.
- NO emoji icons. Use refined symbolic decorations only (thin lines, small dots, hairline frames).
- Generous whitespace and refined typographic hierarchy. Calm, mature, magazine quality.
- Final canvas aspect ratio: 9:16 (portrait), single image.
- Japanese characters should look plausibly correct; if uncertain about a glyph, prefer approximate shapes — typography PLACEMENT, weight and style matter more than perfect glyph rendering.
`.trim();

function buildPrompt(v: MockupVariant): string {
  return `${SHARED_COMPOSITION}

VARIANT "${v.title}":
- Color palette: ${v.palette}
- Typography style: ${v.typography}
- Overall feel: ${v.feel}
${v.notes ? `- Notes: ${v.notes}\n` : ""}
Treat this as a single magazine-quality keyvisual board, photographed flat. Mature target audience.`;
}

export interface GenerateMockupsOptions {
  outDir?: string;
  model?: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  variantIds?: string[];
}

export async function generateRankingDesignMockups(
  opts: GenerateMockupsOptions = {},
): Promise<{ outDir: string; generated: { id: string; path: string }[] }> {
  const model = opts.model ?? process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  const size = opts.size ?? "1024x1536";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir =
    opts.outDir ?? path.join(channelDataRoot("ranking"), "design-mockups", stamp);
  await fs.mkdir(outDir, { recursive: true });

  const targets =
    opts.variantIds && opts.variantIds.length > 0
      ? VARIANTS.filter((v) => opts.variantIds!.includes(v.id))
      : VARIANTS;

  if (targets.length === 0) {
    throw new Error(`No matching variants for ids=${opts.variantIds?.join(",")}`);
  }

  const client = new OpenAI({ apiKey: config.openai.apiKey });

  const generated: { id: string; path: string }[] = [];
  const log: string[] = [
    `# Ranking Design Mockups (${stamp})`,
    "",
    `- Model: \`${model}\``,
    `- Size: ${size}`,
    `- Variants: ${targets.length}`,
    "",
  ];

  console.log(
    chalk.bold(`\n✦ Generating ${targets.length} mockup(s) with ${model} (${size})`),
  );
  console.log(chalk.dim(`  → ${outDir}\n`));

  for (const v of targets) {
    log.push(`## ${v.id} — ${v.title}`, "", "```", buildPrompt(v), "```", "");
  }

  const concurrency = 3;
  const queue = [...targets];
  async function worker(): Promise<void> {
    while (true) {
      const v = queue.shift();
      if (!v) return;
      const prompt = buildPrompt(v);
      console.log(chalk.cyan(`▶ ${v.id} — ${v.title}`));
      const t0 = Date.now();
      try {
        const result = await client.images.generate({
          model,
          prompt,
          size,
          n: 1,
        });
        const b64 = result.data?.[0]?.b64_json;
        if (!b64) throw new Error("No b64_json in response");
        const filePath = path.join(outDir, `${v.id}.png`);
        await fs.writeFile(filePath, Buffer.from(b64, "base64"));
        const ms = Date.now() - t0;
        console.log(chalk.green(`  ✔ ${v.id}  (${ms}ms)`));
        generated.push({ id: v.id, path: filePath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`  ✗ ${v.id}: ${msg}`));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  await fs.writeFile(path.join(outDir, "prompts.md"), log.join("\n"), "utf8");
  console.log(
    chalk.bold(`\n✓ ${generated.length}/${targets.length} mockup(s) saved to ${outDir}\n`),
  );
  return { outDir, generated };
}

// ============================================================================
// rosegold-3panel mode: 03 matte-rosegold をベースに、ショート動画の代表 3 シーン
// (HOOK / PRODUCT REVEAL / PRODUCT WITH REVIEWS) を横 1 枚に並べたモックを生成。
// ショートでバズる事を目的に、強いフック+整った高級感+派手すぎない、を狙う。
// ============================================================================

const ROSEGOLD_BASE = `
Style baseline (locked across all variations):
- Matte black background with very subtle dark marble or fine grain texture (premium, not clickbait).
- Soft rose gold metallic accents — NOT bright pink, NOT yellow gold. Think champagne / antique copper-rose.
- Ivory / soft cream text. NO pure white, NO neon, NO heavy black stroke outlines.
- Sleek modern Japanese mincho serif for headlines; thin sans-serif for tiny labels.
- Hairline rose gold rules and minimal frames. Generous whitespace.
- Aesthetic reference: Tom Ford packaging × Aesop × a luxury watch advertorial. Mature men in their late 20s to 30s.
`.trim();

const SHORTS_VIRAL_INTENT = `
This is design for a Japanese vertical SHORT-FORM video (TikTok / YouTube Shorts / Instagram Reels) that MUST go viral while staying premium. That means:
- The HOOK panel must stop the thumb in the first 0.5 seconds — bold, large, intriguing typography. Use a curiosity-driven Japanese phrase「神アイテム3選」as the main headline, with a punchy subline 「30代男のデスクが捗る」. No emoji, no garish color — but the typography itself must feel charged and confident.
- Visual hierarchy must be unmistakable at thumbnail size. The number ranks (第3位 / 第1位) should read instantly even in a tiny preview.
- Reviews on panel 3 must feel like real user voice — short, casual quoted phrases (e.g. 「正直、買って良かった」「もう手放せない」「コスパ良すぎ」) — but rendered as elegant editorial cards with thin rose gold rules and small serif quotation marks, NOT cartoon speech bubbles.
- Treat each panel as a real screenshot of a 9:16 vertical short, displayed side-by-side on a presentation board.
`.trim();

const ROSEGOLD_3PANEL_COMPOSITION = `
Compose a single LANDSCAPE keyvisual board (3:2 aspect ratio) that displays THREE vertical 9:16 short-video panels arranged side-by-side, separated by very thin rose gold hairline divider rules. Each panel is a proportionally-correct vertical short screenshot.

Panel 1 (left) — HOOK / OPENING:
- Headline 「神アイテム3選」 huge in mincho serif, ivory color, slightly tracked.
- Subline 「30代男のデスクが捗る」 smaller below.
- Tiny rose gold ornamental motif (a thin diamond or hairline horizontal stroke) for accent.
- Small label "01 HOOK" at the very bottom in rose gold small caps.

Panel 2 (center) — PRODUCT REVEAL:
- A confident "第1位" rank mark in mincho serif, with a delicate rose gold underline or numeral-mark ornament.
- A premium product placeholder card (a clean ivory/silver rectangle suggesting an executive gadget — minimalist tech accessory) centered, with a refined rose gold hairline frame.
- Small "BRAND / CATEGORY" label below in tiny letter-spaced sans-serif.
- Small label "02 REVEAL" at bottom in rose gold small caps.

Panel 3 (right) — PRODUCT WITH USER REVIEWS:
- The same product card slightly dimmed and shifted upper.
- Three short Japanese review quote cards stacked or staggered — each card is matte black with thin rose gold border, ivory text, leading and trailing serif quotation marks. Reviews like 「正直、買って良かった」「もう手放せない」「コスパ良すぎ」.
- A tiny "第1位" mark stays small in the corner for context.
- Small label "03 REVIEWS" at bottom in rose gold small caps.

Layout precision:
- All three panels EQUAL width, fully visible, none cropped.
- The three vertical panels feel like phone screenshots displayed flat on a dark presentation surface.
- ALL Japanese characters should be plausible (typography placement, weight and rhythm matter most). If glyph perfection is uncertain, prefer cleaner approximations over garbled marks.
`.trim();

interface RosegoldVariation {
  id: string;
  title: string;
  twist: string;
}

const ROSEGOLD_VARIATIONS: RosegoldVariation[] = [
  {
    id: "rg-A-balanced",
    title: "Balanced editorial triptych",
    twist:
      "Balanced composition. Calm pacing. Subtle grain on background. Rose gold rank numerals are restrained but unmistakable. Feels like a triptych in a Japanese fashion magazine.",
  },
  {
    id: "rg-B-dramatic",
    title: "Dramatic hook, bigger ranks",
    twist:
      "Crank the HOOK panel typography ~25% larger and slightly tighter tracking — the headline 「神アイテム3選」 must feel almost cinematic. Rose gold numerals on rank marks have a subtle metallic specular highlight. Background black is deeper, with hint of marble. Highest stop-the-thumb potential while staying mature.",
  },
  {
    id: "rg-C-restrained",
    title: "Restrained minimal",
    twist:
      "More restrained — even more whitespace, very thin rose gold accents almost approaching champagne. Typography quieter. Feels like an Aesop product page. Sophistication over impact.",
  },
  {
    id: "rg-D-photographic",
    title: "Photographic depth",
    twist:
      "Treat the board itself as a photograph: directional studio lighting from upper left, shallow depth of field hint on background marble, slight bokeh away from the panels. Rose gold elements catch the light realistically. Feels like a luxury watch ad still, but the three short-video panels remain crisp and flat.",
  },
];

function buildRosegoldPrompt(v: RosegoldVariation): string {
  return `${ROSEGOLD_BASE}

${ROSEGOLD_3PANEL_COMPOSITION}

${SHORTS_VIRAL_INTENT}

VARIATION "${v.title}":
${v.twist}`;
}

async function generateOneImageWithFallback(
  client: OpenAI,
  primaryModel: string,
  prompt: string,
  size: "1024x1024" | "1024x1536" | "1536x1024" | "auto",
): Promise<{ b64: string; modelUsed: string }> {
  try {
    const result = await client.images.generate({ model: primaryModel, prompt, size, n: 1 });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error("No b64_json in response");
    return { b64, modelUsed: primaryModel };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNotFound = /model.*(not found|does not exist|invalid|unknown)|404/i.test(msg);
    if (isNotFound && primaryModel !== "gpt-image-1") {
      console.log(
        chalk.yellow(`  ⚠ ${primaryModel} unavailable, falling back to gpt-image-1`),
      );
      const result = await client.images.generate({
        model: "gpt-image-1",
        prompt,
        size,
        n: 1,
      });
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw new Error("No b64_json in response (fallback)");
      return { b64, modelUsed: "gpt-image-1" };
    }
    throw err;
  }
}

export async function generateRosegold3PanelBoards(
  opts: { outDir?: string; model?: string } = {},
): Promise<{ outDir: string; generated: { id: string; path: string }[] }> {
  const requestedModel =
    opts.model ?? process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
  const size: "1536x1024" = "1536x1024";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir =
    opts.outDir ?? path.join(channelDataRoot("ranking"), "design-mockups", `rosegold-${stamp}`);
  await fs.mkdir(outDir, { recursive: true });

  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const generated: { id: string; path: string }[] = [];
  const log: string[] = [
    `# Rosegold 3-Panel Mockups (${stamp})`,
    "",
    `- Requested model: \`${requestedModel}\` (auto-fallback to \`gpt-image-1\` if unavailable)`,
    `- Size: ${size} (landscape 3:2, three 9:16 panels side-by-side)`,
    `- Variations: ${ROSEGOLD_VARIATIONS.length}`,
    "",
  ];
  for (const v of ROSEGOLD_VARIATIONS) {
    log.push(`## ${v.id} — ${v.title}`, "", "```", buildRosegoldPrompt(v), "```", "");
  }

  console.log(
    chalk.bold(
      `\n✦ Generating ${ROSEGOLD_VARIATIONS.length} rosegold 3-panel board(s) with ${requestedModel} (${size})`,
    ),
  );
  console.log(chalk.dim(`  → ${outDir}\n`));

  const concurrency = 3;
  const queue = [...ROSEGOLD_VARIATIONS];
  async function worker(): Promise<void> {
    while (true) {
      const v = queue.shift();
      if (!v) return;
      console.log(chalk.cyan(`▶ ${v.id} — ${v.title}`));
      const t0 = Date.now();
      try {
        const { b64, modelUsed } = await generateOneImageWithFallback(
          client,
          requestedModel,
          buildRosegoldPrompt(v),
          size,
        );
        const filePath = path.join(outDir, `${v.id}.png`);
        await fs.writeFile(filePath, Buffer.from(b64, "base64"));
        const ms = Date.now() - t0;
        console.log(chalk.green(`  ✔ ${v.id}  (${ms}ms, model=${modelUsed})`));
        generated.push({ id: v.id, path: filePath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`  ✗ ${v.id}: ${msg}`));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  await fs.writeFile(path.join(outDir, "prompts.md"), log.join("\n"), "utf8");
  console.log(
    chalk.bold(
      `\n✓ ${generated.length}/${ROSEGOLD_VARIATIONS.length} board(s) saved to ${outDir}\n`,
    ),
  );
  return { outDir, generated };
}

// 自己実行:
//   tsx src/ranking-design-mockups.ts [--variants 01,02]
//   tsx src/ranking-design-mockups.ts --mode rosegold-3panel
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const mode = get("--mode") ?? "all-variants";
  const model = get("--model");
  if (mode === "rosegold-3panel") {
    generateRosegold3PanelBoards({ model }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    const variants = get("--variants");
    const size = get("--size") as GenerateMockupsOptions["size"];
    generateRankingDesignMockups({
      variantIds: variants
        ? variants
            .split(",")
            .map((s) => s.trim())
            .map((s) => (VARIANTS.find((v) => v.id === s || v.id.startsWith(s)) ?? { id: s }).id)
        : undefined,
      model,
      size,
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
