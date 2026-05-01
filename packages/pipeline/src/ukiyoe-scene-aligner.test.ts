import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { CaptionWord } from "@rekishi/shared";
import {
  alignUkiyoeScenes,
  assertSceneTranscriptOrder,
} from "./ukiyoe-scene-aligner.js";

function wordsFromText(text: string): CaptionWord[] {
  return [...text].map((char, i) => ({
    text: char,
    startSec: i * 0.1,
    endSec: (i + 1) * 0.1,
  }));
}

const scenes = [
  "衝撃。三千万円を借金しアフリカで死んだ偉人、野口英世。",
  "一八七六年、福島の貧しい農家に生まれる。本名、清作。",
  "二十歳。上京資金はわずか二ヶ月で酒と賭け事に消える。",
];

describe("assertSceneTranscriptOrder", () => {
  it("allows an ASR transcript that follows the scene narration order", () => {
    const words = wordsFromText(scenes.join(""));

    assert.doesNotThrow(() => assertSceneTranscriptOrder(words, scenes));
  });

  it("rejects an ASR transcript that starts from a later scene", () => {
    const brokenText = [
      "二十歳。上京資金は僅か二ヶ月で酒と掛け事に消える。",
      "恩師の援助も虚しく、夜の歓楽街で放蕩を繰り返す。",
      "三千万円を借金しアフリカで死んだ偉人、野口英世。",
      "一八七六年、福島の貧しい農家に生まれる。本名、清作。",
    ].join("");

    assert.throws(
      () => assertSceneTranscriptOrder(wordsFromText(brokenText), scenes),
      /ASR transcript does not follow script order/,
    );
  });
});

describe("alignUkiyoeScenes", () => {
  it("fails fast instead of returning short scene timings for broken ASR order", () => {
    const brokenText = [
      "二十歳。上京資金は僅か二ヶ月で酒と掛け事に消える。",
      "恩師の援助も虚しく、夜の歓楽街で放蕩を繰り返す。",
      "三千万円を借金しアフリカで死んだ偉人、野口英世。",
      "一八七六年、福島の貧しい農家に生まれる。本名、清作。",
    ].join("");

    assert.throws(
      () =>
        alignUkiyoeScenes({
          words: wordsFromText(brokenText),
          totalDurationSec: 12,
          sceneNarrations: scenes,
        }),
      /ASR transcript does not follow script order/,
    );
  });
});
