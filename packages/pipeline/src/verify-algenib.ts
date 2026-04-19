/**
 * 本番コード (synthesizeNarration) で Algenib + 案②プロンプト + hook [intense] タグを通しで検証。
 * 出力: data/audio/voice-compare/Algenib-final.wav
 *
 * 実行: pnpm --filter @rekishi/pipeline exec tsx src/verify-algenib.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { synthesizeNarration } from "./tts-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

// c7938952/script.json の hook / narration をそのまま利用
const HOOK = "ペリー来航とは、日本の鎖国を終わらせた歴史的事件である。";
const NARRATION =
  "ペリー来航とは、日本の鎖国を終わらせた歴史的事件である。19世紀半ば。アメリカは捕鯨船の寄港地と清への航路を求めていた。狙うは極東の日本。1853年、『いやでござんす』ペリー来航。東インド艦隊司令長官のペリーが、黒船4隻で浦賀に出現。老中の阿部正弘に国書を渡し、開国を迫った。翌年、日米和親条約を締結。200年以上続いた鎖国体制が、ついに崩壊した。共通テストでは、この条約で開港した２つの港が頻出だぞ。";

async function main() {
  const dest = path.join(REPO_ROOT, "data/audio/voice-compare/Algenib-final.wav");
  console.log(`[verify] synthesizing via synthesizeNarration() → ${dest}`);
  const t0 = Date.now();
  const r = await synthesizeNarration(NARRATION, dest, { hook: HOOK });
  console.log(
    `ok: ${r.approxDurationSec.toFixed(1)}s audio, ${r.characters}文字, ` +
      `in=${r.usage.inputTokens}tok out=${r.usage.outputTokens}tok, ${Date.now() - t0}ms`,
  );
  console.log(`\nOpen: open ${path.dirname(dest)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
