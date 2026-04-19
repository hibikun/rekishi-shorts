import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CaptionWord, Scene } from "@rekishi/shared";
import { alignScenesToAudio, computeLcsSpan, normalize } from "./scene-aligner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function loadJob(jobId: string): {
  scenes: Scene[];
  words: CaptionWord[];
  totalDurationSec: number;
} {
  const scenePlan = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "data", "scripts", jobId, "scene-plan.json"),
      "utf-8",
    ),
  );
  const wordsDoc = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "data", "captions", jobId, "words.json"),
      "utf-8",
    ),
  );
  const plan = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "data", "scripts", jobId, "render-plan.json"),
      "utf-8",
    ),
  );
  return {
    scenes: scenePlan.scenes,
    words: wordsDoc.words,
    totalDurationSec: plan.totalDurationSec ?? plan.audio?.durationSec ?? 0,
  };
}

describe("computeLcsSpan", () => {
  it("returns null for empty inputs", () => {
    assert.equal(computeLcsSpan("", "abc"), null);
    assert.equal(computeLcsSpan("abc", ""), null);
  });

  it("finds exact substring match", () => {
    const r = computeLcsSpan("応仁の乱", "xx応仁の乱yy")!;
    assert.equal(r.lcsLen, 4);
    assert.equal(r.firstJ, 2);
    assert.equal(r.lastJ, 5);
  });

  it("finds order-preserving span with gap", () => {
    // s に無い文字を t に混ぜても first/last は s の順序で返る
    const r = computeLcsSpan("応仁の乱", "応x仁yの乱")!;
    assert.equal(r.lcsLen, 4);
    assert.equal(r.firstJ, 0);
    assert.equal(r.lastJ, 5);
  });

  it("ignores reverse matches (order-preserving)", () => {
    // t 側で順序が逆転した文字は LCS に入らない
    const r = computeLcsSpan("abc", "cba")!;
    assert.equal(r.lcsLen, 1);
  });
});

describe("normalize", () => {
  it("strips punctuation and quotes", () => {
    assert.equal(normalize("応仁の乱とは、「大乱」である。"), "応仁の乱とは大乱である");
  });

  it("converts full-width digits to half-width", () => {
    assert.equal(normalize("1467年"), "1467年");
  });
});

describe("alignScenesToAudio — 717de18d regression", () => {
  const { scenes, words, totalDurationSec } = loadJob("717de18d");

  it("scene 0 starts at 0 (Whisper 冒頭取りこぼし対応)", () => {
    const { captionSegments } = alignScenesToAudio(scenes, words, totalDurationSec);
    assert.equal(
      captionSegments[0]!.startSec,
      0,
      "first captionSegment must start at 0 so narration 冒頭 is captioned",
    );
  });

  it("scene 3 '1467年...' falls within [14.0, 18.5]s and lasts >= 1.0s", () => {
    const { captionSegments } = alignScenesToAudio(scenes, words, totalDurationSec);
    const s3 = captionSegments[3]!;
    assert.ok(
      s3.startSec >= 14.0 && s3.startSec <= 15.5,
      `scene 3 startSec=${s3.startSec}, expected in [14.0, 15.5] (was 18.38 before fix)`,
    );
    assert.ok(
      s3.endSec >= 17.0 && s3.endSec <= 18.5,
      `scene 3 endSec=${s3.endSec}, expected in [17.0, 18.5] (was 18.56 before fix)`,
    );
    const duration = s3.endSec - s3.startSec;
    assert.ok(
      duration >= 1.0,
      `scene 3 duration=${duration.toFixed(2)}s, expected >= 1.0s (was 0.18s before fix)`,
    );
  });

  it("captionSegments are contiguous and cover [0, totalDurationSec]", () => {
    const { captionSegments } = alignScenesToAudio(scenes, words, totalDurationSec);
    assert.equal(captionSegments[0]!.startSec, 0);
    for (let i = 1; i < captionSegments.length; i++) {
      assert.equal(
        captionSegments[i]!.startSec,
        captionSegments[i - 1]!.endSec,
        `gap/overlap at scene ${i}: prev.endSec=${captionSegments[i - 1]!.endSec}, curr.startSec=${captionSegments[i]!.startSec}`,
      );
    }
    const lastEnd = captionSegments[captionSegments.length - 1]!.endSec;
    assert.ok(
      Math.abs(lastEnd - totalDurationSec) < 0.1,
      `last endSec=${lastEnd}, expected ≈ ${totalDurationSec}`,
    );
  });

  it("alignedScenes durations sum to totalDurationSec", () => {
    const { scenes: alignedScenes } = alignScenesToAudio(scenes, words, totalDurationSec);
    const sum = alignedScenes.reduce((a, s) => a + s.durationSec, 0);
    assert.ok(
      Math.abs(sum - totalDurationSec) < 0.05,
      `sum of durations=${sum}, expected ≈ ${totalDurationSec}`,
    );
  });

  it("captionSegments[i].endSec matches cumulative alignedScenes duration", () => {
    const result = alignScenesToAudio(scenes, words, totalDurationSec);
    let cursor = 0;
    for (let i = 0; i < result.scenes.length; i++) {
      cursor += result.scenes[i]!.durationSec;
      assert.ok(
        Math.abs(result.captionSegments[i]!.endSec - cursor) < 0.01,
        `scene ${i}: caption endSec=${result.captionSegments[i]!.endSec}, scene cumulative=${cursor}`,
      );
    }
  });
});
