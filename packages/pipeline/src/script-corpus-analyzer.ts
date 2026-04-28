// script-corpus-analyzer: Gemini で analysis.md を下書き / patterns.md を蒸留

import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { config } from "./config.js";
import {
  type CorpusMeta,
  type TranscriptResult,
  corpusPaths,
  listCorpusSlugs,
} from "./script-corpus.js";

const CORPUS_ROOT = path.join(config.paths.repoRoot, "research", "script-corpus");
const PATTERNS_PATH = path.join(CORPUS_ROOT, "patterns.md");

const ANALYZE_MODEL = process.env.GEMINI_CORPUS_ANALYZE_MODEL ?? config.gemini.scriptModel;
const DISTILL_MODEL = process.env.GEMINI_CORPUS_DISTILL_MODEL ?? config.gemini.scriptModel;

function readMeta(slug: string): CorpusMeta {
  const { metaPath } = corpusPaths(slug);
  if (!fs.existsSync(metaPath)) throw new Error(`meta.json が見つからない: ${slug}`);
  return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
}

function readTranscript(slug: string): TranscriptResult {
  const { transcriptPath } = corpusPaths(slug);
  if (!fs.existsSync(transcriptPath)) throw new Error(`transcript.json が見つからない: ${slug}`);
  return JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
}

function transcriptToTimestampedText(transcript: TranscriptResult): string {
  return transcript.segments
    .map((s) => `[${s.start.toFixed(2)}-${s.end.toFixed(2)}] ${s.text}`)
    .join("\n");
}

const ANALYZE_PROMPT = `あなたはバズるショート動画の脚本を構造分析する専門家です。
以下の動画の文字起こし（タイムスタンプ付き）から、脚本の構造を読み解いてください。

## 対象動画メタ
- タイトル: {{title}}
- チャンネル: {{channel}}
- 尺: {{duration}}秒
- 言語: {{language}}
- 再生数: {{views}}

## 文字起こし
\`\`\`
{{transcript}}
\`\`\`

## 出力フォーマット
以下のMarkdownを**そのまま**出力してください。frontmatter は付けない。各セクションを丁寧に埋めること。

\`\`\`markdown
## Beat構造
| 区間 | 役割 | 内容 |
|---|---|---|
| 0.0-X.X | フック | （要約） |
| X.X-Y.Y | 展開1 | ... |
| ... | ... | ... |

## フック技法
- 分類: （以下から該当を選び複数可: 否定 / 質問 / 数字 / 逆説 / 未来予告 / 情景 / 当事者発話 / 共感 / 警告）
- 引用: 「（フック部分の原文）」
- なぜ効くか: （1-2文。視聴者の心理がどう動くか）

## 好奇心ギャップ
- 設置: X秒地点で「（原文）」 — 何を未解決にしているか
- 回収: Y秒地点で「（原文）」 — どう解決しているか
- ※ 複数あれば箇条書きで複数挙げる。無ければ「明示的なギャップ設計なし」と書く

## リフレイン・キーフレーズ
- 「（フレーズ）」が N 回反復 — どんな効果か
- ※ 反復が無ければ「顕著な反復なし」

## 文の長短リズム
- 平均語数/秒: X.X
- 最短文: 「...」（X語） — どこに置かれているか
- 最長文: 「...」（X語） — どこに置かれているか
- リズムの特徴: （短文と長文の配置パターン）

## クロージングの型
- 分類: （情景 / 問い / 宣言 / 数字 / 続編予告 / 行動指示 / 余韻 から該当）
- 引用: 「（最終1-2文の原文）」
- なぜ効くか: （1文）

## rekishi に転用できる原則
- （箇条書き3-5個。日本史ショート動画に応用できる具体的な原則として書く）
- （例: 「フックで結論を否定形で示すと続きを聞かせやすい」など、抽象化された移植可能な学び）

## メモ（人による校正）
（ここは空欄のままで良い。人がレビュー時に追記する）
\`\`\`

注意:
- 引用は文字起こしの原文を必ずそのまま使う（翻訳しない）
- 「語数/秒」は英語なら単語数、日本語なら文節数で見積もる
- 推測ではなく文字起こしから読み取れることだけ書く
`;

function renderAnalyzePrompt(meta: CorpusMeta, transcript: TranscriptResult): string {
  return ANALYZE_PROMPT.replace(/\{\{title\}\}/g, meta.title)
    .replace(/\{\{channel\}\}/g, meta.channel)
    .replace(/\{\{duration\}\}/g, String(meta.durationSeconds))
    .replace(/\{\{language\}\}/g, meta.language)
    .replace(/\{\{views\}\}/g, meta.viewCount?.toLocaleString() ?? "不明")
    .replace(/\{\{transcript\}\}/g, transcriptToTimestampedText(transcript));
}

function buildAnalysisFile(meta: CorpusMeta, body: string): string {
  return `---
slug: ${meta.slug}
video_id: ${meta.videoId}
analyzed_at: ${new Date().toISOString().slice(0, 10)}
status: draft
---

# 脚本分析: ${meta.title}

## メタ
- チャンネル: ${meta.channel}
- 再生数: ${meta.viewCount?.toLocaleString() ?? "不明"}
- 尺: ${meta.durationSeconds}秒
- 言語: ${meta.language}
- URL: ${meta.url}

${body.trim()}
`;
}

/** Gemini 出力に時々付くコードフェンスを剥がす */
function stripMarkdownFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:markdown|md)?\n?/, "").replace(/```\s*$/, "");
  }
  return t.trim();
}

export async function corpusAnalyze(slug: string): Promise<void> {
  console.log(chalk.bold(`\n🔬 corpus analyze: ${slug}\n`));
  const meta = readMeta(slug);
  const transcript = readTranscript(slug);
  const { analysisPath } = corpusPaths(slug);

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const prompt = renderAnalyzePrompt(meta, transcript);

  console.log(chalk.gray(`  🤖 Gemini (${ANALYZE_MODEL}) で分析中...`));
  const response = await ai.models.generateContent({
    model: ANALYZE_MODEL,
    contents: prompt,
    config: { temperature: 0.3 },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini が空のレスポンスを返した");
  const body = stripMarkdownFence(text);

  fs.writeFileSync(analysisPath, buildAnalysisFile(meta, body));
  console.log(chalk.green(`✅ analysis.md を更新 (status=draft)`));
  console.log(chalk.dim(`   ${analysisPath}`));
  console.log(chalk.bold("\n次のステップ:"));
  console.log(`  1. ${chalk.cyan(analysisPath)} を開いてレビュー・校正`);
  console.log(`  2. frontmatter を ${chalk.cyan("status: reviewed")} に変更`);
  console.log(`  3. 何本か溜まったら ${chalk.cyan("pnpm --filter @rekishi/pipeline corpus distill")}`);
}

interface AnalysisFile {
  slug: string;
  status: string;
  body: string;
  meta: CorpusMeta;
}

function readAnalysis(slug: string): AnalysisFile | null {
  const { analysisPath } = corpusPaths(slug);
  if (!fs.existsSync(analysisPath)) return null;
  const raw = fs.readFileSync(analysisPath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch || !fmMatch[1]) return null;
  const fm = fmMatch[1];
  const statusMatch = fm.match(/^status:\s*(\S+)/m);
  const status = statusMatch?.[1] ?? "empty";
  const body = raw.slice(fmMatch[0].length);
  return { slug, status, body, meta: readMeta(slug) };
}

const DISTILL_PROMPT = `あなたはショート動画脚本のパターン分析家です。
以下は複数本の動画について個別に書かれた構造分析（status: reviewed のもの）です。
これらを横断して、繰り返し現れる「効く脚本パターン」を蒸留してください。

## 入力（{{count}}本の analysis）
{{analyses}}

## 出力
以下のMarkdownを出力してください。frontmatterは付けない。

\`\`\`markdown
# patterns.md

corpus 全体から蒸留した「効く脚本パターン」。{{date}} 更新 / {{count}}本から蒸留。

## フック技法ランキング
| 技法 | 出現本数 | 代表例（slug: 引用） | なぜ効くか |
|---|---|---|---|
| ... | ... | ... | ... |

（出現頻度の高い順に並べる。3〜7行程度）

## クロージング技法ランキング
（同上のフォーマット）

## 共通する好奇心ギャップ設計
- パターン名: 説明（代表例 slug）
- ...

## リズム傾向
- 語数/秒の分布: （低〜高の幅、典型値）
- 短文挿入の使われ方:
- 反復フレーズの使われ方:

## rekishi への移植候補（優先度順）
1. **原則名**: 説明（具体的にどう日本史ショート脚本に応用するか）
2. ...
3. ...

（rekishi/prompts/script.md にどう取り込むか、移植可能性が高い順に3〜5個）
\`\`\`

注意:
- 引用は分析中の引用をそのまま使う
- 1本しかパターンが現れていないものは「個別事例」として除外し、複数本に共通するものだけを「パターン」として扱う
- rekishi 移植候補は、日本史×受験生向けという文脈で実際に効きそうなものに絞る
`;

export async function corpusDistill(opts: { includeDrafts?: boolean } = {}): Promise<void> {
  console.log(chalk.bold(`\n🧪 corpus distill\n`));
  const slugs = listCorpusSlugs();
  if (slugs.length === 0) {
    console.log(chalk.yellow("  ⚠️ corpus が空。先に corpus add → analyze を実行してください"));
    return;
  }

  const analyses = slugs
    .map(readAnalysis)
    .filter((a): a is AnalysisFile => a !== null)
    .filter((a) => opts.includeDrafts || a.status === "reviewed");

  if (analyses.length === 0) {
    const reviewedCount = slugs
      .map(readAnalysis)
      .filter((a): a is AnalysisFile => a !== null)
      .filter((a) => a.status === "reviewed").length;
    console.log(
      chalk.yellow(
        `  ⚠️ 蒸留対象なし (reviewed=${reviewedCount}/${slugs.length}). analysis.md の frontmatter を status: reviewed にしてください。`,
      ),
    );
    console.log(chalk.dim("     drafts も含めたい場合は --include-drafts オプション"));
    return;
  }

  console.log(chalk.gray(`  🤖 Gemini (${DISTILL_MODEL}) で ${analyses.length} 本を蒸留中...`));

  const formatted = analyses
    .map(
      (a) =>
        `### ${a.slug} (${a.meta.channel} / 再生${a.meta.viewCount?.toLocaleString() ?? "不明"} / ${a.meta.durationSeconds}s / ${a.meta.language})\n${a.body.trim()}`,
    )
    .join("\n\n---\n\n");

  const prompt = DISTILL_PROMPT.replace(/\{\{count\}\}/g, String(analyses.length))
    .replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10))
    .replace(/\{\{analyses\}\}/g, formatted);

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const response = await ai.models.generateContent({
    model: DISTILL_MODEL,
    contents: prompt,
    config: { temperature: 0.3 },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini が空のレスポンスを返した");
  const body = stripMarkdownFence(text);

  fs.writeFileSync(PATTERNS_PATH, body.endsWith("\n") ? body : `${body}\n`);
  console.log(chalk.green(`\n✅ patterns.md を更新 (${analyses.length}本から蒸留)`));
  console.log(chalk.dim(`   ${PATTERNS_PATH}`));
}
