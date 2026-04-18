import fs from "node:fs/promises";
import path from "node:path";
import { dataPath } from "../config.js";
import type { StorageAdapter } from "./adapter.js";

export class LocalStorageAdapter implements StorageAdapter {
  async ensureJobDir(jobId: string, subdir: string): Promise<string> {
    const dir = dataPath(subdir, jobId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async save(localPath: string, _logicalPath: string): Promise<string> {
    // local ではそのまま返す
    return localPath;
  }
}

export function jobPath(jobId: string, subdir: string, filename: string): string {
  return path.join(dataPath(subdir, jobId), filename);
}
