/**
 * ranking チャンネル用に「大人でリッチ」な声候補を一括生成して比較するスクリプト。
 *
 * - 本番と同じ synthesizeNarration() を呼ぶ → STYLE_PROMPTS と loudnorm が production と同条件
 * - narrator / reviewer の persona ごとに別フォルダへ書き出し、聴き比べやすくする
 *
 * 出力: data/ranking/voice-compare/<persona>-<voice>.wav
 * 実行: pnpm --filter @rekishi/pipeline exec tsx src/compare-ranking-voices.ts
 */
import path from "node:path";
import fs from "node:fs/promises";
import { channelDataRoot } from "@rekishi/shared/channel";
import { synthesizeNarration } from "./tts-generator.js";

// ---- 候補ボイス ----------------------------------------------------------
// Gemini TTS prebuilt voices から「大人でリッチ」寄りを抽出。
// 末尾コメントは Google 公式の voice character 表記。
const NARRATOR_VOICES = [
  "Kore", // (firm) — 現行 default。比較リファレンス
  "Algenib", // (gravelly) — ドキュメンタリー寄りの低めの男声
  "Charon", // (informative) — ニュースアンカー風
  "Orus", // (firm) — 落ち着いた男声
  "Gacrux", // (mature) — そのまま「大人」キーワードの voice
  "Sulafat", // (warm) — 温かみのある中低音
  "Sadaltager", // (knowledgeable) — 教養番組風
] as const;

const REVIEWER_VOICES = [
  "Puck", // (upbeat) — 現行 default。比較リファレンス
  "Algieba", // (smooth) — 滑らかな大人系
  "Despina", // (smooth) — もう一つの smooth 候補
  "Vindemiatrix", // (gentle) — 落ち着いたトーン
  "Zubenelgenubi", // (casual) — レビュー会話に合う自然な口調
  "Achird", // (friendly) — 親しみのある大人声
  "Sulafat", // (warm) — narrator/reviewer 両用候補
] as const;

// ---- サンプル文 ----------------------------------------------------------
// 「5000円以下で生活がガチで捗る神商品」の三本立てを想定。
const NARRATOR_TEXT =
  "5000円以下で生活がガチで捗る、神商品ベスト3。Amazonで実際に買える、コスパ最強の便利アイテムを厳選した。第1位、毎朝の歯磨きが激変する電動歯ブラシ。税込3980円。";

const REVIEWER_TEXT =
  "いやこれマジで買って良かった。朝の歯磨きが2分で終わるのに、歯医者帰りみたいなツルツル感。もっと早く買えば良かった。";

async function main() {
  const outDir = path.join(channelDataRoot("ranking"), "voice-compare");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`[voice-compare] out=${outDir}`);
  console.log(
    `[voice-compare] narrator (${NARRATOR_VOICES.length}): ${NARRATOR_VOICES.join(", ")}`,
  );
  console.log(
    `[voice-compare] reviewer (${REVIEWER_VOICES.length}): ${REVIEWER_VOICES.join(", ")}`,
  );
  console.log("");

  // Gemini TTS preview の per-minute レート制限 (10 req/min) に当たらないよう sequential。
  // 失敗時は tts-generator.ts の retryOn429 が拾う。
  for (const voice of NARRATOR_VOICES) {
    const dest = path.join(outDir, `narrator-${voice}.wav`);
    process.stdout.write(`  - narrator ${voice.padEnd(14)} ... `);
    const t0 = Date.now();
    try {
      const r = await synthesizeNarration(NARRATOR_TEXT, dest, {
        voiceName: voice,
        persona: "narrator",
      });
      console.log(
        `ok (${r.approxDurationSec.toFixed(1)}s audio, ${(
          (Date.now() - t0) / 1000
        ).toFixed(1)}s wall)`,
      );
    } catch (e) {
      console.log(`FAIL: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  console.log("");

  for (const voice of REVIEWER_VOICES) {
    const dest = path.join(outDir, `reviewer-${voice}.wav`);
    process.stdout.write(`  - reviewer ${voice.padEnd(14)} ... `);
    const t0 = Date.now();
    try {
      const r = await synthesizeNarration(REVIEWER_TEXT, dest, {
        voiceName: voice,
        persona: "reviewer",
      });
      console.log(
        `ok (${r.approxDurationSec.toFixed(1)}s audio, ${(
          (Date.now() - t0) / 1000
        ).toFixed(1)}s wall)`,
      );
    } catch (e) {
      console.log(`FAIL: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  console.log(`\n✅ Done. 開く: open ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
