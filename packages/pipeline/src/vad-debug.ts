/**
 * VAD デバッグツール: 指定 jobId の narration.wav に対して無音検出結果を出力する。
 * 使い方: tsx src/vad-debug.ts <jobId>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ScenePlanSchema } from "@rekishi/shared";
import { dataPath } from "./config.js";
import { readWav, computeFrameRmsDb, computeSilenceThresholdDb, detectSilences } from "./vad-aligner.js";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("usage: tsx src/vad-debug.ts <jobId>");
    process.exit(1);
  }
  const audioPath = dataPath("audio", jobId, "narration.wav");
  const scenePlanPath = dataPath("scripts", jobId, "scene-plan.json");

  const wav = readWav(audioPath);
  const { dbValues } = computeFrameRmsDb(wav);
  const threshold = computeSilenceThresholdDb(dbValues);
  const silences = detectSilences(wav);
  const scenePlan = ScenePlanSchema.parse(JSON.parse(await fs.readFile(scenePlanPath, "utf-8")));

  console.log(`\n=== WAV: ${audioPath}`);
  console.log(`samples=${wav.samples.length} rate=${wav.sampleRate} channels=${wav.channels}`);
  console.log(`duration=${(wav.samples.length / wav.sampleRate).toFixed(2)}s`);
  console.log(`threshold=${threshold.toFixed(1)} dBFS`);

  console.log(`\n=== 無音区間 (${silences.length} 件):`);
  for (const [idx, s] of silences.entries()) {
    console.log(`  [${idx}] ${s.startSec.toFixed(3)}s - ${s.endSec.toFixed(3)}s  (${s.durationSec * 1000 | 0}ms, mean=${s.meanDb}dB)`);
  }

  console.log(`\n=== scene narration:`);
  for (const sc of scenePlan.scenes) {
    const last = sc.narration.slice(-1);
    const kind = (last === "。" || last === "！" || last === "？") ? "P" : "C";
    console.log(`  #${String(sc.index).padStart(2)} [${kind}${last}] ${sc.narration}`);
  }

  // 実行結果の確認
  const { matchScenesToSilences } = await import("./vad-aligner.js");
  const totalDur = wav.samples.length / wav.sampleRate;
  const result = matchScenesToSilences(scenePlan.scenes, silences, totalDur);
  console.log(`\n=== matchScenesToSilences 結果:`);
  console.log(`   matched ${result.matchedCount}/${scenePlan.scenes.length - 1}`);
  let prev = 0;
  for (let i = 0; i < result.boundaries.length; i++) {
    const b = result.boundaries[i]!;
    const sc = scenePlan.scenes[i]!;
    const dur = b.endSec - prev;
    const cps = sc.narration.length / dur;
    const mark = b.fromVad ? "V" : "i";
    console.log(`  #${String(sc.index).padStart(2)} [${mark}] ${prev.toFixed(3).padStart(6)}s - ${b.endSec.toFixed(3)}s (${dur.toFixed(3)}s, ${cps.toFixed(1)}cps) ${sc.narration}`);
    prev = b.endSec;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
