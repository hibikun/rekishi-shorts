import { z } from "zod";

export const ImageSourceSchema = z.enum(["wikimedia", "generated", "fallback"]);
export type ImageSource = z.infer<typeof ImageSourceSchema>;

export const ImageAssetSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  source: ImageSourceSchema,
  /** file:// 絶対パス または http(s) URL */
  path: z.string(),
  license: z.string().describe("例: CC-BY-SA-4.0, PD, Gemini"),
  attribution: z.string().optional(),
  sourceUrl: z.string().url().optional().describe("Wikimedia ページURL等"),
});
export type ImageAsset = z.infer<typeof ImageAssetSchema>;

export const AudioAssetSchema = z.object({
  /** 絶対パス */
  path: z.string(),
  durationSec: z.number().positive(),
  format: z.enum(["mp3", "wav"]).default("mp3"),
});
export type AudioAsset = z.infer<typeof AudioAssetSchema>;

export const CaptionWordSchema = z.object({
  text: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
});
export type CaptionWord = z.infer<typeof CaptionWordSchema>;

export const CaptionTrackSchema = z.object({
  words: z.array(CaptionWordSchema),
});
export type CaptionTrack = z.infer<typeof CaptionTrackSchema>;
