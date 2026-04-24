import path from "node:path";
import type { Script, ThreePickItem } from "@rekishi/shared";

function pickReferenceUrl(item: ThreePickItem): string {
  return item.officialUrl || item.affiliateUrl || "";
}

function itemRow(item: ThreePickItem): string {
  const url = pickReferenceUrl(item);
  const urlCell = url ? `[link](${url})` : "（未取得）";
  return `| ${item.rank} | ${item.name} | ${item.brand ?? ""} | ${urlCell} | \`assets/item-${item.rank}.png\` |`;
}

function keywordLine(item: ThreePickItem): string {
  const kw = item.searchKeywords || `${item.brand ?? ""} ${item.name}`.trim();
  return `- rank${item.rank}: ${kw}`;
}

export interface NextStepsInput {
  script: Script;
  jobId: string;
  channel: string;
  assetsDirRelative: string;
}

export function buildNextStepsMarkdown(input: NextStepsInput): string {
  const { script, jobId, channel, assetsDirRelative } = input;
  const items = (script.items ?? []).slice().sort((a, b) => a.rank - b.rank);

  const ttsCmd = `pnpm --filter @rekishi/pipeline exec tsx src/cli.ts tts-only --channel ${channel} --job-id ${jobId}`;
  const buildCmd = `pnpm --filter @rekishi/pipeline exec tsx src/cli.ts build-ranking-plan --channel ${channel} --job-id ${jobId}`;
  const renderCmd = `pnpm --filter @rekishi/pipeline exec tsx src/cli.ts render-ranking --channel ${channel} --job-id ${jobId}`;

  return `# ${script.topic.title} — 画像配置ガイド

jobId: \`${jobId}\` / channel: \`${channel}\`

## 手順

1. 下記「商品一覧」の **参考URL** から商品画像をダウンロード
2. \`${assetsDirRelative}/\` に以下のファイル名で保存（拡張子は png / webp / jpg / jpeg いずれも可）
   - \`item-1\` （第1位）
   - \`item-2\` （第2位）
   - \`item-3\` （第3位）
   - \`background\` （ブラー背景 — 任意の雰囲気画像で可）
3. ナレーション音声を Gemini TTS で合成 → plan 構築 → レンダリング

\`\`\`bash
${ttsCmd}
${buildCmd}
${renderCmd}
\`\`\`

## 商品一覧

| rank | 商品名 | ブランド | 参考URL | 配置先 |
|------|-------|---------|---------|--------|
${items.map(itemRow).join("\n")}

## 検索キーワード（URL が見つからないとき用）

${items.map(keywordLine).join("\n")}
`;
}

export interface StdoutGuideInput {
  script: Script;
  jobId: string;
  channel: string;
  assetsDirAbsolute: string;
  nextStepsPath: string;
}

export function buildStdoutGuideLines(input: StdoutGuideInput): string[] {
  const { script, jobId, channel, assetsDirAbsolute, nextStepsPath } = input;
  const items = (script.items ?? []).slice().sort((a, b) => a.rank - b.rank);
  const lines: string[] = [];
  lines.push("📸 次の手順: 商品画像をダウンロードして配置してください");
  lines.push(`   配置先: ${assetsDirAbsolute}/`);
  lines.push(`   詳細: ${path.basename(nextStepsPath)}`);
  lines.push("");
  for (const it of items) {
    const ref = it.officialUrl || it.affiliateUrl || it.searchKeywords || "（参考URL未取得）";
    lines.push(`   [${it.rank}] ${it.name}${it.brand ? ` (${it.brand})` : ""}`);
    lines.push(`       → item-${it.rank}.png  参考: ${ref}`);
  }
  lines.push("");
  lines.push(`   配置後: pnpm --filter @rekishi/pipeline exec tsx src/cli.ts tts-only --channel ${channel} --job-id ${jobId}`);
  lines.push(`           pnpm --filter @rekishi/pipeline exec tsx src/cli.ts build-ranking-plan --channel ${channel} --job-id ${jobId}`);
  return lines;
}
