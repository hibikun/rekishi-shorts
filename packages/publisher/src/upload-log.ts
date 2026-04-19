import fs from "node:fs/promises";
import path from "node:path";
import { UploadLogEntrySchema, type UploadLogEntry } from "./index.js";
import { dataPath } from "./config.js";

function logFilePath(): string {
  return dataPath("uploads", "log.jsonl");
}

export async function appendUploadLog(entry: UploadLogEntry): Promise<void> {
  const parsed = UploadLogEntrySchema.parse(entry);
  const file = logFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(parsed) + "\n", "utf-8");
}

export async function hasBeenUploaded(jobId: string): Promise<UploadLogEntry | null> {
  const file = logFilePath();
  let content: string;
  try {
    content = await fs.readFile(file, "utf-8");
  } catch {
    return null;
  }
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // 後方から走査して最新を返す
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = UploadLogEntrySchema.parse(JSON.parse(lines[i]!));
      if (entry.jobId === jobId) return entry;
    } catch {
      continue;
    }
  }
  return null;
}
