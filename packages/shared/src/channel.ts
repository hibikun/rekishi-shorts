import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

export const DEFAULT_CHANNEL = "rekishi";

let currentChannel: string = DEFAULT_CHANNEL;

export function setChannel(id: string): void {
  if (!id) throw new Error("channel id must be a non-empty string");
  currentChannel = id;
}

export function getChannel(): string {
  return currentChannel;
}

export function channelPackageDir(channel: string = currentChannel): string {
  return path.join(REPO_ROOT, "packages", "channels", channel);
}

export function promptPath(name: string, channel: string = currentChannel): string {
  return path.join(channelPackageDir(channel), "prompts", `${name}.md`);
}

export function channelDocsDir(channel: string = currentChannel): string {
  return path.join(channelPackageDir(channel), "docs");
}

export function channelDataRoot(channel: string = currentChannel): string {
  return path.join(REPO_ROOT, "data", channel);
}

export function channelDataPath(...segments: string[]): string {
  return path.join(channelDataRoot(), ...segments);
}
