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
