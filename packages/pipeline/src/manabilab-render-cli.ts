/**
 * Manabilab plan-driven Remotion render を subprocess で実行するための entry。
 *
 * Web API から `tsx packages/pipeline/src/manabilab-render-cli.ts <planId>` で
 * 呼び出される。Next.js の webpack が Remotion 内部の binary asset (esbuild 等) を
 * bundle できない問題を回避するため、subprocess で Node ネイティブ実行する。
 *
 * 出力:
 *   stdout の最終行に JSON 1行で結果を吐く: `RESULT_JSON: {...}`
 *   進捗は `PROGRESS: 0.42` の形で stdout に流す。
 */
import { renderManabilabPlan } from "./manabilab-render.js";

async function main(): Promise<void> {
  const planId = process.argv[2];
  if (!planId) {
    console.error("Usage: tsx manabilab-render-cli.ts <planId>");
    process.exit(2);
  }

  let lastReportedPct = -1;
  const result = await renderManabilabPlan(planId, {
    onProgress: (p) => {
      const pct = Math.floor(p * 100);
      // 同じ%は重複出力しない
      if (pct !== lastReportedPct && pct % 5 === 0) {
        lastReportedPct = pct;
        console.log(`PROGRESS: ${p.toFixed(3)}`);
      }
    },
  });

  // Web API がパースする最終出力（必ず1行で）
  console.log(`RESULT_JSON: ${JSON.stringify(result)}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`ERROR: ${message}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
