import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildUkiyoeVideoPrompt,
  resolveCameraFixed,
} from "./ukiyoe-video-generator.js";

describe("ukiyoe video prompt motion defaults", () => {
  it("uses energetic camera guidance for active action tags", () => {
    const prompt = buildUkiyoeVideoPrompt({
      index: 0,
      imagePath: "/tmp/scene.png",
      scenePrompt: "An Edo sushi chef runs to Nihonbashi fish market.",
      actionTag: "running_forward",
    });

    assert.match(prompt, /energetic parallax/);
    assert.match(prompt, /strong foreground-background motion/);
    assert.doesNotMatch(prompt, /subtly/i);
  });

  it("does not default food, crowd, or weather scenes to locked camera", () => {
    for (const actionTag of [
      "eating_meal",
      "crowd_cheering",
      "weather_dynamic",
    ] as const) {
      assert.equal(
        resolveCameraFixed({
          index: 0,
          imagePath: "/tmp/scene.png",
          scenePrompt: "",
          actionTag,
        }),
        false,
      );
    }
  });
});
