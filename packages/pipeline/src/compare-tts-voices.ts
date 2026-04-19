/**
 * 4声比較: 同じナレーションを Algenib / Fenrir / Gacrux / Alnilam で生成する。
 * 出力先: data/audio/voice-compare/<voice>.wav
 *
 * 実行: pnpm --filter @rekishi/pipeline exec tsx ../../scripts/compare-tts-voices.ts
 *   or: pnpm tsx scripts/compare-tts-voices.ts (ルート直下で)
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { Buffer } from "node:buffer";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");
dotenv.config({ path: path.join(REPO_ROOT, ".env.local") });
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const SAMPLE_RATE = 24000;
const MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";
const VOICES = ["Algenib", "Fenrir", "Gacrux", "Alnilam"] as const;

// c7938952/script.json (ペリー来航) からそのまま拝借
const NARRATION =
  "ペリー来航とは、日本の鎖国を終わらせた歴史的事件である。19世紀半ば。アメリカは捕鯨船の寄港地と清への航路を求めていた。狙うは極東の日本。1853年、『いやでござんす』ペリー来航。東インド艦隊司令長官のペリーが、黒船4隻で浦賀に出現。老中の阿部正弘に国書を渡し、開国を迫った。翌年、日米和親条約を締結。200年以上続いた鎖国体制が、ついに崩壊した。共通テストでは、この条約で開港した２つの港が頻出だぞ。";

const STYLE_DIRECTIVE =
  "Deliver this Japanese history short in a dramatic, urgent, intense narration style — like a documentary narrator revealing a shocking historical moment. Fast pace, emphatic stress on key names and years, tight energy throughout. Avoid a calm classroom tone.";

async function synth(voiceName: string, destPath: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const prompt = `${STYLE_DIRECTIVE}\n\n${NARRATION}`;

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });

  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const audioPart = parts.find((p) => (p as { inlineData?: unknown }).inlineData !== undefined);
  const inlineData = audioPart
    ? (audioPart as { inlineData?: { data?: string } }).inlineData
    : undefined;
  if (!inlineData?.data) {
    throw new Error(`[${voiceName}] no audio in response: ${JSON.stringify(res).slice(0, 400)}`);
  }

  const pcm = Buffer.from(inlineData.data, "base64");
  const wav = wrapPcmAsWav(pcm, SAMPLE_RATE, 1, 16);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, wav);
  const sec = pcm.length / (SAMPLE_RATE * 2);
  return { sec, bytes: wav.length };
}

function wrapPcmAsWav(pcm: Buffer, sampleRate: number, channels: number, bits: number): Buffer {
  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

async function main() {
  const outDir = path.join(REPO_ROOT, "data/audio/voice-compare");
  console.log(`[compare] model=${MODEL} voices=${VOICES.join(",")} out=${outDir}`);
  for (const v of VOICES) {
    const dest = path.join(outDir, `${v}.wav`);
    process.stdout.write(`  - ${v} ... `);
    const t0 = Date.now();
    const { sec, bytes } = await synth(v, dest);
    console.log(`ok (${sec.toFixed(1)}s audio, ${(bytes / 1024).toFixed(0)}KB, ${Date.now() - t0}ms)`);
  }
  console.log(`\nDone. Open: open ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
