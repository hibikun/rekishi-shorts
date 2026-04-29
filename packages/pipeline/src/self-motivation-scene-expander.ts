import type {
  SelfMotivationScene,
  SelfMotivationScript,
} from "@rekishi/shared";
import { generateSceneId } from "./self-motivation-paths.js";

const TARGET_MIN_CHARS = 25;
const TARGET_MAX_CHARS = 80;

/**
 * 1 段落を「2〜3 フレーズ単位」に分割する。
 *
 * - 句読点（。、！？!?）でフラグメント化
 * - フラグメントを順に結合し、結合後文字数が TARGET_MIN_CHARS を超えたら 1 シーンとして確定
 * - 結合後文字数が TARGET_MAX_CHARS を超えそうなら手前で確定
 * - 末尾のあぶれた短いフラグメントは前のシーンに連結
 */
export function splitParagraphIntoSceneTexts(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];

  const fragments: string[] = [];
  let buf = "";
  for (const ch of trimmed) {
    buf += ch;
    if (/[。、！？!?]/.test(ch)) {
      fragments.push(buf);
      buf = "";
    }
  }
  if (buf.trim().length > 0) fragments.push(buf);

  if (fragments.length === 0) return [];

  const scenes: string[] = [];
  let pending = "";
  for (const frag of fragments) {
    const candidate = pending + frag;
    if (
      candidate.length >= TARGET_MIN_CHARS ||
      candidate.length >= TARGET_MAX_CHARS - 10
    ) {
      scenes.push(candidate.trim());
      pending = "";
    } else {
      pending = candidate;
    }
  }
  if (pending.trim().length > 0) {
    if (scenes.length === 0) {
      scenes.push(pending.trim());
    } else {
      // 末尾が短い場合は最後のシーンに併合
      scenes[scenes.length - 1] += pending.trim();
    }
  }

  return scenes;
}

/**
 * 章立て台本を Scene 配列に展開する。
 * sceneId は安定不変。物理ファイル名はこの ID を使う。
 */
export function expandScriptToScenes(
  script: SelfMotivationScript,
): SelfMotivationScene[] {
  const out: SelfMotivationScene[] = [];
  let runningIndex = 0;

  // openingHook を最初のシーンとして入れる（chapterIndex=-1 を避けるため、特別扱いはせず章0扱い）
  // → openingHook 専用シーンは入れず、各章の冒頭で章タイトル + 段落として展開する設計にする。
  //   openingHook はレンダリング時に title card 等で別表示する想定。
  //   ただし MVP ではシンプルに「openingHook → chapter1.paragraph[0..n] → ... → closingCta」を
  //   1 連の Scene 配列として展開する（Composition 側で先頭をオープニング扱いして良い）。

  // hook を最初の 1 シーンに
  for (const sceneText of splitParagraphIntoSceneTexts(script.openingHook)) {
    out.push(makeScene(sceneText, runningIndex++, 0, 0));
  }

  // 各章 → 各段落 → 句読点分割
  script.chapters.forEach((chapter, chapterIndex) => {
    chapter.narrationParagraphs.forEach((paragraph, paragraphIndex) => {
      const sceneTexts = splitParagraphIntoSceneTexts(paragraph);
      for (const sceneText of sceneTexts) {
        out.push(
          makeScene(sceneText, runningIndex++, chapterIndex, paragraphIndex),
        );
      }
    });
  });

  // closingCta
  for (const sceneText of splitParagraphIntoSceneTexts(script.closingCta)) {
    out.push(
      makeScene(sceneText, runningIndex++, script.chapters.length, 0),
    );
  }

  return out;
}

function makeScene(
  narration: string,
  index: number,
  chapterIndex: number,
  paragraphIndex: number,
): SelfMotivationScene {
  return {
    sceneId: generateSceneId(),
    index,
    chapterIndex,
    paragraphIndex,
    narration,
    imagePromptJa: "",
    imagePromptEn: "",
    motionPresetId: "auto",
  };
}
