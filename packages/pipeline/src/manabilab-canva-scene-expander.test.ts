import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { ManabilabCanvaScript } from "@rekishi/shared";
import {
  expandScriptToScenes,
  splitByPunctuation,
} from "./manabilab-canva-scene-expander.js";

describe("splitByPunctuation", () => {
  it("splits hook into 3 scenes by ? and 。", () => {
    const out = splitByPunctuation(
      "甘いもの食べて記憶力アップ？もっといいものあります。暗記に特化したチート食材3選。",
    );
    assert.deepEqual(out, [
      "甘いもの食べて記憶力アップ？",
      "もっといいものあります。",
      "暗記に特化したチート食材3選。",
    ]);
  });

  it("splits a statement into 3 scenes", () => {
    const out = splitByPunctuation(
      "勉強の1時間前に3かけ食え。甘いチョコは論外。カカオのフラバノールが脳の血流を爆上げします。",
    );
    assert.deepEqual(out, [
      "勉強の1時間前に3かけ食え。",
      "甘いチョコは論外。",
      "カカオのフラバノールが脳の血流を爆上げします。",
    ]);
  });

  it("merges short leading chunk (e.g. いち、) into the next chunk", () => {
    const out = splitByPunctuation("いち、ダークチョコレート。");
    assert.deepEqual(out, ["いち、ダークチョコレート。"]);
  });

  it("merges short trailing chunk into the previous chunk", () => {
    // 末尾が「！」だけの 1 字 chunk になる想定 → 前と結合
    const out = splitByPunctuation("脳がスッキリする。最強！");
    assert.deepEqual(out, ["脳がスッキリする。最強！"]);
  });

  it("returns empty array for whitespace-only input", () => {
    assert.deepEqual(splitByPunctuation("  　  "), []);
  });

  it("returns the single chunk when there is no punctuation", () => {
    assert.deepEqual(splitByPunctuation("脳に血が回る"), ["脳に血が回る"]);
  });

  it("handles ASCII !? as well", () => {
    const out = splitByPunctuation("これマジ?知らんと損する!");
    assert.deepEqual(out, ["これマジ?", "知らんと損する!"]);
  });
});

describe("expandScriptToScenes", () => {
  const script: ManabilabCanvaScript = {
    topic: {
      title: "暗記力が増す食べ物3選",
      subject: "学習科学",
      target: "汎用",
      format: "single",
    },
    hook: "甘いもの食べて記憶力アップ？もっといいものあります。暗記に特化したチート食材3選。",
    statements: [
      {
        label: "1. ダークチョコ",
        claim: "勉強の1時間前に3かけ食え。甘いチョコは論外。",
        backupLogic: "カカオのフラバノールが脳の血流を爆上げします。",
      },
    ],
    cta: "明日の朝、コンビニでチョコを買え。",
    punchline: "これで覚えられなかったら知らん。",
    title: { top: "テスト前の糖分補給", bottom: "実は記憶力下げてます" },
    readings: [],
    estimatedDurationSec: 30,
  };

  it("expands hook into 3 scenes split at ？/。/。", () => {
    const scenes = expandScriptToScenes(script);
    const hookScenes = scenes.filter((s) => s.source.kind === "hook");
    assert.equal(hookScenes.length, 3);
    assert.equal(hookScenes[0]?.narration, "甘いもの食べて記憶力アップ？");
    assert.equal(hookScenes[1]?.narration, "もっといいものあります。");
    assert.equal(hookScenes[2]?.narration, "暗記に特化したチート食材3選。");
  });

  it("expands a statement into 3 scenes covering claim + backupLogic", () => {
    const scenes = expandScriptToScenes(script);
    const stmtScenes = scenes.filter(
      (s) => s.source.kind === "statement" && s.source.statementIndex === 0,
    );
    assert.equal(stmtScenes.length, 3);
    assert.equal(stmtScenes[0]?.narration, "勉強の1時間前に3かけ食え。");
    assert.equal(stmtScenes[1]?.narration, "甘いチョコは論外。");
    assert.equal(
      stmtScenes[2]?.narration,
      "カカオのフラバノールが脳の血流を爆上げします。",
    );
  });

  it("uses statement.label as the lead caption only on the first chunk", () => {
    const scenes = expandScriptToScenes(script);
    const stmtScenes = scenes.filter(
      (s) => s.source.kind === "statement" && s.source.statementIndex === 0,
    );
    assert.equal(stmtScenes[0]?.caption, "1. ダークチョコ");
    // 2 番目以降は narration から自動生成された caption（label ではない）
    assert.notEqual(stmtScenes[1]?.caption, "1. ダークチョコ");
  });

  it("renumbers index sequentially across all segments starting from 1", () => {
    const scenes = expandScriptToScenes(script);
    scenes.forEach((s, i) => assert.equal(s.index, i + 1));
  });

  it("initializes prompt fields as empty strings for manual editing", () => {
    const scenes = expandScriptToScenes(script);
    for (const s of scenes) {
      assert.equal(s.imagePromptJa, "");
      assert.equal(s.imagePromptEn, "");
      assert.equal(s.seedancePromptJa, "");
      assert.equal(s.seedancePromptEn, "");
    }
  });
});
