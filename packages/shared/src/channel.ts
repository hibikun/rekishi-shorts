import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

export const DEFAULT_CHANNEL = "rekishi";

const CHANNEL_SUBJECT_DEFAULTS: Record<string, string> = {
  rekishi: "日本史",
  kosei: "生物",
  "kosei-animation": "生物",
  ranking: "ガジェット",
};

const FALLBACK_SUBJECT = "日本史";

export function channelSubjectDefault(channel: string = currentChannel): string {
  return CHANNEL_SUBJECT_DEFAULTS[channel] ?? FALLBACK_SUBJECT;
}

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

/**
 * チャンネル既定アセット (BGM / SFX 等) の置き場。
 * `packages/channels/<channel>/assets/<kind>/` を返す。
 * 中身はライセンス都合で gitignore 管理（実体はローカルに各自配置）。
 */
export function channelAssetsDir(
  kind: string,
  channel: string = currentChannel,
): string {
  return path.join(channelPackageDir(channel), "assets", kind);
}

export function channelDataRoot(channel: string = currentChannel): string {
  return path.join(REPO_ROOT, "data", channel);
}

export function channelDataPath(...segments: string[]): string {
  return path.join(channelDataRoot(), ...segments);
}
