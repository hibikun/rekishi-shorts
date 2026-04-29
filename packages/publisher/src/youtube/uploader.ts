import fs from "node:fs";
import { google } from "googleapis";
import chalk from "chalk";
import type { YouTubeMetadata } from "../index.js";
import { createAuthClient } from "./auth.js";

export interface UploadInput {
  videoPath: string;
  metadata: YouTubeMetadata;
}

export interface UploadResult {
  videoId: string;
  url: string;
  uploadedAt: string;
}

export async function uploadToYouTube(input: UploadInput): Promise<UploadResult> {
  const { videoPath, metadata } = input;

  const stat = fs.statSync(videoPath);
  const totalBytes = stat.size;

  const auth = createAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  let lastLogged = 0;
  const stream = fs.createReadStream(videoPath);

  // 注: `containsSyntheticMedia`（AI生成開示）は 2026年初頭時点で
  // YouTube Data API v3 のリクエストボディには公開されておらず、
  // Studio の「動画編集」画面からのみ設定可能。metadata では保持して
  // 将来 API サポート時に即座に送信できるようにしているが、現状は
  // アップロード後に手動で Studio で設定する必要がある。

  // 予約投稿: publishAt がある場合 YouTube 仕様で privacyStatus は private 必須
  const scheduled = !!metadata.publishAt;
  const effectivePrivacyStatus = scheduled ? "private" : metadata.privacyStatus;

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    notifySubscribers: true,
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
      },
      status: {
        privacyStatus: effectivePrivacyStatus,
        publishAt: metadata.publishAt,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: "video/mp4",
      body: stream,
    },
  }, {
    onUploadProgress: (evt: { bytesRead: number }) => {
      const pct = totalBytes > 0 ? Math.floor((evt.bytesRead / totalBytes) * 100) : 0;
      if (pct >= lastLogged + 10 || pct === 100) {
        lastLogged = pct - (pct % 10);
        console.log(chalk.dim(`   upload progress: ${pct}% (${evt.bytesRead}/${totalBytes} bytes)`));
      }
    },
  });

  const videoId = res.data.id;
  if (!videoId) throw new Error("YouTube API returned no video ID");

  return {
    videoId,
    url: `https://youtube.com/shorts/${videoId}`,
    uploadedAt: new Date().toISOString(),
  };
}

export interface SetThumbnailInput {
  videoId: string;
  imagePath: string;
}

export interface SetThumbnailResult {
  videoId: string;
  imageUrl: string;
}

export async function setThumbnail(input: SetThumbnailInput): Promise<SetThumbnailResult> {
  const { videoId, imagePath } = input;

  const stat = fs.statSync(imagePath);
  const MAX_BYTES = 2 * 1024 * 1024;
  if (stat.size > MAX_BYTES) {
    throw new Error(`サムネイル画像が 2MB 制限を超えています: ${stat.size} bytes (${imagePath})`);
  }

  const ext = imagePath.toLowerCase().split(".").pop();
  const mimeType =
    ext === "png" ? "image/png" :
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
    ext === "gif" ? "image/gif" :
    ext === "bmp" ? "image/bmp" :
    null;
  if (!mimeType) {
    throw new Error(`サムネイル画像の拡張子が未対応です: .${ext} (PNG / JPG / GIF / BMP のみ)`);
  }

  const auth = createAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  const res = await youtube.thumbnails.set({
    videoId,
    media: {
      mimeType,
      body: fs.createReadStream(imagePath),
    },
  });

  const imageUrl =
    res.data.items?.[0]?.maxres?.url ??
    res.data.items?.[0]?.high?.url ??
    res.data.items?.[0]?.medium?.url ??
    res.data.items?.[0]?.default?.url ??
    "";

  return { videoId, imageUrl };
}

export function formatUploadError(err: unknown): string {
  const anyErr = err as { code?: number; errors?: Array<{ reason?: string; message?: string }>; message?: string };
  const reason = anyErr.errors?.[0]?.reason;
  const msg = anyErr.errors?.[0]?.message ?? anyErr.message ?? String(err);

  if (reason === "quotaExceeded") {
    return `YouTube API のクォータを使い切りました (videos.insert は 1,600 units / デフォルト 10,000 units/日)。\n   明日リセット or audit 申請: https://support.google.com/youtube/contact/yt_api_form`;
  }
  if (reason === "invalid_grant" || /invalid_grant/.test(msg)) {
    return `refresh_token が失効または取り消されています。\n   scripts/youtube-auth.ts を再実行して取得し直してください。`;
  }
  if (reason === "youtubeSignupRequired") {
    return `このアカウントに YouTube チャンネルが紐付いていません。Studio でチャンネルを作成してください。`;
  }
  if (reason) return `${reason}: ${msg}`;
  return msg;
}
