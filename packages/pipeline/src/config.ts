import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// repo root の .env.local を明示的に読む（pnpm monorepo では cwd が package dir になるため）
const REPO_ROOT = path.resolve(__dirname, "../../../");
dotenv.config({ path: path.join(REPO_ROOT, ".env.local") });
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set. Copy .env.local.example to .env.local and fill it in.`);
  return v;
}

export const config = {
  gemini: {
    apiKey: requireEnv("GEMINI_API_KEY"),
    scriptModel: process.env.GEMINI_SCRIPT_MODEL ?? "gemini-3.1-pro-preview",
    sceneModel: process.env.GEMINI_SCENE_MODEL ?? "gemini-3.1-flash-lite-preview",
    imageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview",
  },
  elevenlabs: {
    apiKey: requireEnv("ELEVENLABS_API_KEY"),
    voiceId: requireEnv("ELEVENLABS_VOICE_ID"),
    model: process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2",
  },
  openai: {
    apiKey: requireEnv("OPENAI_API_KEY"),
    whisperModel: process.env.WHISPER_MODEL ?? "whisper-1",
    textTranscribeModel: process.env.OPENAI_TEXT_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
  },
  paths: {
    /** repo root (rekishi-shorts/) */
    repoRoot: path.resolve(__dirname, "../../../"),
    dataRoot: path.resolve(__dirname, "../../../data"),
  },
} as const;

export function dataPath(...segments: string[]): string {
  return path.join(config.paths.dataRoot, ...segments);
}
