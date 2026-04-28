import { ScriptSchema, type Script, type Topic } from "@rekishi/shared";
import type { QueueFile, QueueFrontmatter } from "./auto-rekishi-queue.js";

/**
 * draft 完了後の Script + research.md + 補足メタを queue ファイル形式に落とす。
 * jobId は draft 段階で確保したものを保持し、publish 相でも同じ id を使う。
 */
export interface ToQueueFileInput {
  script: Script;
  research: string;
  slug: string;
  jobId: string;
  poolTitle?: string;
  poolLineNumber?: number;
  pattern?: string;
}

export function scriptToQueueFile(
  input: ToQueueFileInput,
  filePath: string,
): QueueFile {
  const { script, research, slug, jobId, poolTitle, poolLineNumber, pattern } = input;
  const meta: QueueFrontmatter = {
    status: "review-needed",
    slug,
    jobId,
    poolTitle,
    poolLineNumber,
    era: script.topic.era,
    pattern,
    videoTitleTop: script.title.top || undefined,
    videoTitleBottom: script.title.bottom,
    mnemonic: script.mnemonic || undefined,
    estimatedDurationSec: script.estimatedDurationSec,
  };

  return {
    filePath,
    meta,
    narration: script.narration,
    hook: script.hook,
    body: script.body,
    closing: script.closing,
    keyTerms: [...script.keyTerms],
    readings: { ...script.readings },
    research: demoteHeadings(research),
  };
}

/**
 * research.md を queue ファイルの `## research` セクションに埋める前に、
 * 内部の `^##` を `^###` に下げて、queue 側の section parser を壊さないようにする。
 */
function demoteHeadings(md: string): string {
  return md
    .split(/\r?\n/)
    .map((line) => {
      const m = /^(#+)\s/.exec(line);
      if (!m) return line;
      // # を 1 段下げる（## → ###）。深すぎる場合 (#### 以上) はそのまま
      const depth = m[1]!.length;
      return depth >= 2 && depth <= 5 ? "#" + line : line;
    })
    .join("\n");
}

/**
 * queue ファイル → Script へ復元する。publish 相の build に渡す script.json の元になる。
 *
 * 注意:
 *   - hook / body / closing が空のときは narration から自動補完する（zod 必須を満たすため）
 *   - estimatedDurationSec がなければ narration の長さから概算する
 *   - title.top は空文字許容、title.bottom は必須
 */
export function queueFileToScript(file: QueueFile): Script {
  const { meta } = file;
  const topic: Topic = {
    title: meta.poolTitle ?? meta.videoTitleBottom,
    era: meta.era,
    subject: "日本史",
    target: "汎用",
    format: "single",
  };

  const narration = file.narration.trim();
  if (narration.length < 50) {
    throw new Error(
      `${file.filePath}: ## narration が ${narration.length} 字しかありません（50字以上必要）`,
    );
  }

  const hook = file.hook.trim() || firstSentence(narration);
  const body = file.body.trim() || narration;
  const closing = file.closing.trim() || lastSentence(narration);

  const estimated =
    meta.estimatedDurationSec ?? Math.round(narration.length * 0.2);

  return ScriptSchema.parse({
    topic,
    narration,
    hook,
    title: {
      top: meta.videoTitleTop ?? "",
      bottom: meta.videoTitleBottom,
    },
    body,
    closing,
    mnemonic: meta.mnemonic,
    keyTerms: file.keyTerms,
    readings: file.readings,
    estimatedDurationSec: estimated,
  });
}

function firstSentence(s: string): string {
  const m = /^[^。！？!?]*[。！？!?]/.exec(s);
  return (m?.[0] ?? s).trim();
}

function lastSentence(s: string): string {
  const sentences = s.split(/(?<=[。！？!?])\s*/).filter((x) => x.trim().length > 0);
  return (sentences[sentences.length - 1] ?? s).trim();
}
