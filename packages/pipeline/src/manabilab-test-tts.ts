/**
 * 学びラボ 動画001「ノートまとめは時間の無駄」用の TTS + caption 生成テスト (D3)。
 *
 * 出力:
 *   /tmp/manabilab-test/narration.wav
 *   /tmp/manabilab-test/captions.json   { words, segments, totalDurationSec }
 *
 * 実行:
 *   pnpm --filter @rekishi/pipeline exec tsx src/manabilab-test-tts.ts
 */
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import { setChannel } from "@rekishi/shared/channel";
import type { CaptionSegment, CaptionWord } from "@rekishi/shared";
import { synthesizeNarrationVoicevox } from "./tts-generator.js";
import { alignCaptions } from "./asr-aligner.js";

// VOICEVOX speaker IDs (青山龍星):
//   13=ノーマル / 81=熱血 / 82=不機嫌 / 83=喜び / 84=しっとり / 85=かなしみ / 86=囁き
const VOICEVOX_SPEAKER_ID = 13;

const NARRATION =
  "ノートをまとめることに時間を割くのが記憶が定着しない原因です。認知科学の法則に従って勉強するだけ。1つ目、想起練習。ノートを閉じて思い出すだけ。Karpickeの研究で、思い出したグループは、読み返したグループより記憶定着が2倍以上でした。2つ目、分散学習。1日3時間より、3日に分けて1時間ずつ。これは100年以上前から証明されている分散学習効果です。2週間続けてみてください。次のテストで、驚くほどスラスラ思い出せます。";

const READINGS: Record<string, string> = {
  Karpicke: "カーピック",
};

const OUT_DIR = "/tmp/manabilab-test";
const AUDIO_PATH = path.join(OUT_DIR, "narration.wav");
const CAPTIONS_PATH = path.join(OUT_DIR, "captions.json");

/**
 * 「。」で文ごとに区切り、words のタイムスタンプから segment の開始/終了秒を組む。
 * Bro Pump 風の字幕は短い文単位で切り替わるのが基本（segment ≒ 1〜2文）。
 */
function buildCaptionSegments(narration: string, words: CaptionWord[]): CaptionSegment[] {
  // 句点で区切り、空文字を除外。最後の句点無し残余も拾う。
  const sentences = narration
    .split(/(?<=。)/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const segments: CaptionSegment[] = [];
  let wordCursor = 0;

  for (const sentence of sentences) {
    // この sentence に対応する文字数分の words を消費する
    const targetChars = sentence.replace(/\s+/g, "").length;
    let consumed = 0;
    const startCursor = wordCursor;

    while (wordCursor < words.length && consumed < targetChars) {
      consumed += words[wordCursor]!.text.replace(/\s+/g, "").length;
      wordCursor++;
    }

    if (wordCursor === startCursor) continue;

    const startSec = words[startCursor]!.startSec;
    const endSec = words[wordCursor - 1]!.endSec;
    segments.push({ text: sentence, startSec, endSec });
  }

  return segments;
}

async function main(): Promise<void> {
  setChannel("manabilab");
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(chalk.bold.magenta("\n=== manabilab D3 test: TTS + caption alignment ===\n"));

  console.log(chalk.yellow(`[1/2] VOICEVOX TTS で音声合成中 (speaker=${VOICEVOX_SPEAKER_ID} 青山龍星)...`));
  const tts = await synthesizeNarrationVoicevox(NARRATION, AUDIO_PATH, {
    speakerId: VOICEVOX_SPEAKER_ID,
    readings: READINGS,
    intonationScale: 1.2, // 抑揚 +20% で Bro Pump 風の "強調" を出す
  });
  console.log(
    chalk.green(
      `  ✓ ${tts.characters} 文字 / ${tts.approxDurationSec.toFixed(2)}秒 / ${tts.usage.model}\n`,
    ),
  );

  console.log(chalk.yellow("[2/2] Whisper + gpt-4o-mini で caption アライン中..."));
  const align = await alignCaptions(AUDIO_PATH, {
    scriptText: NARRATION,
    readings: READINGS,
  });
  console.log(
    chalk.green(
      `  ✓ ${align.words.length} 単語 / ${align.totalDurationSec.toFixed(2)}秒 / brokenByGuard=${align.brokenByGuard}\n`,
    ),
  );
  if (align.brokenByGuard) {
    console.log(chalk.dim(`    quality reasons: ${align.qualitySignals.reasons.join(", ")}`));
  }

  const segments = buildCaptionSegments(NARRATION, align.words);

  await fs.writeFile(
    CAPTIONS_PATH,
    JSON.stringify(
      {
        narration: NARRATION,
        readings: READINGS,
        totalDurationSec: align.totalDurationSec,
        ttsApproxDurationSec: tts.approxDurationSec,
        words: align.words,
        segments,
        brokenByGuard: align.brokenByGuard,
      },
      null,
      2,
    ),
  );

  console.log(chalk.bold.green("\n=== Done ==="));
  console.log(`  audio    : ${AUDIO_PATH}`);
  console.log(`  captions : ${CAPTIONS_PATH}`);
  console.log(chalk.gray(`  segments : ${segments.length} 個（句点区切り）`));
  console.log(chalk.gray(`  duration : ${align.totalDurationSec.toFixed(2)}秒`));
  console.log("\n  プレビュー:");
  for (const seg of segments) {
    console.log(
      chalk.dim(`    [${seg.startSec.toFixed(2)}-${seg.endSec.toFixed(2)}] ${seg.text}`),
    );
  }
}

main().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
  process.exit(1);
});
