/**
 * PoC: fal.ai 経由で 1 枚画像 → 動画クリップ生成（Seedance 1.5 Pro）。
 *
 * 既定では rekishi/583c848c の scene-04（崖上の武士・戦場・雷雨）を入力に、
 * 9:16 / 720p / 5 秒 / 無音 で 1 クリップ生成し data/rekishi/poc-videos/ に保存する。
 * 音声なし・720p・5 秒で約 $0.13（≒20円）。
 *
 * 実行:
 *   pnpm --filter @rekishi/pipeline exec tsx src/poc-fal-video.ts
 *
 * 引数で画像とプロンプトを差し替え可:
 *   pnpm --filter @rekishi/pipeline exec tsx src/poc-fal-video.ts <imagePath> "<prompt>"
 */

import { fal } from "@fal-ai/client";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

dotenv.config({ path: path.join(REPO_ROOT, ".env.local") });

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error("[error] FAL_KEY is not set in .env.local");
  process.exit(1);
}

fal.config({ credentials: FAL_KEY });

const DEFAULT_IMAGE = path.join(
  REPO_ROOT,
  "data/rekishi/images/583c848c/scene-04.png",
);

const DEFAULT_PROMPT = [
  "The samurai stands firmly on the cliff, his armor straps and hair flowing in the strong wind.",
  "Lightning flashes brightly across the dark stormy sky behind him.",
  "Heavy rain falls diagonally.",
  "In the valley far below, the army of foot soldiers and cavalry marches forward, banners waving.",
  "The distant castle burns with flickering orange flames and rising black smoke.",
  "Slow cinematic camera push-in toward the samurai.",
  "Maintain the original Japanese ukiyo-e illustration style throughout.",
].join(" ");

const MODEL_ID = "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";

async function main() {
  const [, , argImage, argPrompt] = process.argv;
  const imagePath = argImage ? path.resolve(argImage) : DEFAULT_IMAGE;
  const prompt = argPrompt ?? DEFAULT_PROMPT;

  console.log("[poc] image:", imagePath);
  console.log("[poc] prompt:", prompt);
  console.log("[poc] model:", MODEL_ID);

  const buffer = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).slice(1).toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  const file = new File([buffer], path.basename(imagePath), { type: mime });

  console.log("[poc] uploading image to fal storage...");
  const imageUrl = await fal.storage.upload(file);
  console.log("[poc] uploaded:", imageUrl);

  console.log("[poc] submitting job...");
  const startedAt = Date.now();
  const result = await fal.subscribe(MODEL_ID, {
    input: {
      image_url: imageUrl,
      prompt,
      aspect_ratio: "9:16",
      resolution: "720p",
      duration: "5",
      generate_audio: false,
      camera_fixed: false,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        update.logs?.forEach((log) => console.log("[fal]", log.message));
      } else if (update.status === "IN_QUEUE") {
        console.log(`[fal] queued (position: ${update.queue_position ?? "?"})`);
      }
    },
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[poc] done in ${elapsedSec}s`);

  const videoUrl = (result.data as { video?: { url?: string } })?.video?.url;
  if (!videoUrl) {
    console.error("[error] no video url in response:", JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log("[poc] video url:", videoUrl);

  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const videoBuf = Buffer.from(await res.arrayBuffer());

  const outDir = path.join(REPO_ROOT, "data/rekishi/poc-videos");
  await fs.mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outName = `seedance-15-pro_${path.basename(imagePath, path.extname(imagePath))}_${ts}.mp4`;
  const outPath = path.join(outDir, outName);
  await fs.writeFile(outPath, videoBuf);

  const sizeKb = (videoBuf.byteLength / 1024).toFixed(0);
  console.log(`[poc] saved: ${outPath} (${sizeKb} KB)`);
  console.log("[poc] open with: open", JSON.stringify(outPath));
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
