import { TopicSchema, type Topic } from "@rekishi/shared";
import type { PoolEntry } from "./auto-rekishi-pool.js";

/**
 * `topic-ideas-pool.md` の 1 エントリを Topic に落とす。
 * rekishi auto は a 案（先頭 pop）固定なので、subject/target/format も固定。
 */
export function poolEntryToTopic(entry: PoolEntry): Topic {
  return TopicSchema.parse({
    title: entry.title,
    era: entry.era || undefined,
    subject: "日本史",
    target: "汎用",
    format: "single",
  });
}
