import { z } from "zod";

export const PrivacyStatusSchema = z.enum(["public", "unlisted", "private"]);
export type PrivacyStatus = z.infer<typeof PrivacyStatusSchema>;

export const YouTubeMetadataSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(5000),
  tags: z.array(z.string().min(1)).max(500),
  categoryId: z.string().default("27"),
  privacyStatus: PrivacyStatusSchema.default("public"),
  containsSyntheticMedia: z.boolean().default(true),
});
export type YouTubeMetadata = z.infer<typeof YouTubeMetadataSchema>;

export const UploadLogEntrySchema = z.object({
  jobId: z.string(),
  videoId: z.string(),
  url: z.string().url(),
  uploadedAt: z.string(),
  privacy: PrivacyStatusSchema,
  title: z.string(),
});
export type UploadLogEntry = z.infer<typeof UploadLogEntrySchema>;

export { generateYouTubeMetadata } from "./metadata-generator.js";
export { metadataToDraftMd, draftMdToMetadata } from "./meta-draft-io.js";
export { uploadToYouTube } from "./youtube/uploader.js";
export { createAuthClient } from "./youtube/auth.js";
export { appendUploadLog, hasBeenUploaded } from "./upload-log.js";
