import * as budouxNs from "budoux";
import type { CaptionSegment, SelfMotivationScene } from "@rekishi/shared";

const budouxLoader =
  (
    budouxNs as {
      loadDefaultJapaneseParser?: () => { parseBoundaries(s: string): number[] };
    }
  ).loadDefaultJapaneseParser ??
  (
    budouxNs as {
      default?: {
        loadDefaultJapaneseParser?: () => {
          parseBoundaries(s: string): number[];
        };
      };
    }
  ).default?.loadDefaultJapaneseParser;
if (!budouxLoader) {
  throw new Error("budoux: loadDefaultJapaneseParser export not found");
}
const budouxParser = budouxLoader();

const TARGET_CHARS = 12;
const MAX_CHARS = 22;

function chunkNarration(text: string): string[] {
  const sentences = text
    .split(/(?<=[。、！？!?])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const result: string[] = [];
  for (const sent of sentences) {
    if (sent.length <= MAX_CHARS) {
      result.push(sent);
      continue;
    }
    const boundaries = budouxParser.parseBoundaries(sent);
    let start = 0;
    for (const b of boundaries) {
      if (b - start >= TARGET_CHARS) {
        result.push(sent.slice(start, b));
        start = b;
      }
    }
    if (start < sent.length) {
      const tail = sent.slice(start);
      if (tail.length < 4 && result.length > 0) {
        result[result.length - 1] += tail;
      } else {
        result.push(tail);
      }
    }
  }
  return result;
}

/**
 * Scene 配列から、シーンごとに narration を chunk 分割し、
 * 時間を文字数比例で配分した CaptionSegment 配列を作る。
 */
export function buildLongformCaptionSegments(
  scenes: SelfMotivationScene[],
): CaptionSegment[] {
  const result: CaptionSegment[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    const dur = Math.max(0, scene.audioDurationSec ?? 0);
    const chunks = chunkNarration(scene.narration);
    if (chunks.length === 0 || dur <= 0) {
      cursor += dur;
      continue;
    }
    const totalChars = chunks.reduce((s, c) => s + c.length, 0);
    let local = cursor;
    for (const c of chunks) {
      const ratio = totalChars > 0 ? c.length / totalChars : 1 / chunks.length;
      const segDur = dur * ratio;
      result.push({ text: c, startSec: local, endSec: local + segDur });
      local += segDur;
    }
    cursor += dur;
  }
  return result;
}
