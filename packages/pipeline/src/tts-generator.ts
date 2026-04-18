import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const TTS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

export interface TTSResult {
  path: string;
  /** 実際の mp3 の秒数（ffprobe で後段で測定） */
  approxDurationSec: number;
  /** 課金文字数（furigana置換後） */
  characters: number;
}

/**
 * ナレーション文字列を ElevenLabs TTS で mp3 に変換。
 * 固有名詞の誤読は furigana map で事前置換する。
 */
export async function synthesizeNarration(
  text: string,
  destPath: string,
  opts: { furigana?: Record<string, string> } = {},
): Promise<TTSResult> {
  const processed = applyFurigana(text, opts.furigana);
  const voiceId = config.elevenlabs.voiceId;
  const res = await fetch(`${TTS_ENDPOINT}/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenlabs.apiKey,
      "Content-Type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: processed,
      model_id: config.elevenlabs.model,
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.75,
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${body}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buffer);

  // Rough estimate: 1kbps mp3 は ~16000 bytes/sec。
  // 最終的な durationSec は Whisper 側の max(endSec) で上書きされるので初期値扱い。
  const approxDurationSec = Math.max(1, buffer.byteLength / 16000);
  return { path: destPath, approxDurationSec, characters: processed.length };
}

function applyFurigana(text: string, map?: Record<string, string>): string {
  if (!map) return text;
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}
