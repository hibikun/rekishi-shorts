import fs from "node:fs/promises";
import path from "node:path";
import { dataPath } from "../config.js";
import type { StatsSnapshot } from "./types.js";

function snapshotsFilePath(): string {
  return dataPath("analytics", "snapshots.jsonl");
}

export async function appendSnapshots(snapshots: StatsSnapshot[]): Promise<string> {
  const file = snapshotsFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = snapshots.map((s) => JSON.stringify(s)).join("\n") + (snapshots.length ? "\n" : "");
  await fs.appendFile(file, body, "utf-8");
  return file;
}
