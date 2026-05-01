import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { inferUkiyoeSceneCount } from "./ukiyoe-script-generator.js";
import { splitNarrationIntoSceneSegments } from "./ukiyoe-scene-planner.js";

function normalizeForCompare(s: string): string {
  return s.replace(/[\s　、。．，「」『』（）()！？!?・…—\-]/g, "").trim();
}

describe("splitNarrationIntoSceneSegments", () => {
  it("keeps edited narration exact when repartitioning into scenes", () => {
    const narration = [
      "江戸の寿司、ほぼおにぎりだった。",
      "江戸の寿司職人。一日の始まり。",
      "朝四時、日本橋。狙うは江戸前の小肌と穴子。",
      "朝五時。冷蔵庫などない。酢と塩で魚を締める。",
      "朝七時。酢飯を握る。スシローの5貫分が江戸の1貫分だ。",
      "昼十二時。屋台開店。腹を空かせた江戸っ子が群がる。",
      "箸など使わない。手でつかみ、その場で頬張る。",
      "一貫で腹にたまる。懐は小銭で重くなる。",
      "午後二時。魚が傷めば終わり。暑い日は時間との勝負。",
      "夜。銭湯で匂いを流す。",
      "穴子の夢を見ながらまた明日を迎える。",
    ].join("\n");

    const segments = splitNarrationIntoSceneSegments(narration, 8);

    assert.equal(segments.length, 8);
    assert.equal(segments.join(""), narration);
    assert.equal(
      normalizeForCompare(segments.join("")),
      normalizeForCompare(narration),
    );
    for (const segment of segments) {
      assert.ok(narration.includes(segment));
    }
  });
});

describe("inferUkiyoeSceneCount", () => {
  it("uses natural narration beats instead of a preselected studio count", () => {
    const narration = [
      "江戸の天ぷら職人。一日の始まり。",
      "朝三時。日本橋で、取れたての魚を狙う。",
      "冷蔵庫などない。鮮度こそ命。",
      "朝。厚い衣とごま油。匂いが街へ流れる。",
      "昼。屋台開店。せっかちな江戸っ子が群がる。",
      "天つゆなどない。濃い醤油に漬け、串ごと頬張る。",
      "数時間で数百本。懐は小銭で膨らむ。",
      "火事と隣り合わせ。命がけの屋台商売。",
      "夜。銭湯と酒場で使い切り、明け方また起きる。",
    ].join("\n");

    assert.equal(inferUkiyoeSceneCount(narration, 45), 9);
  });
});
