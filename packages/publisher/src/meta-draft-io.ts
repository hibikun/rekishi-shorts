import {
  PrivacyStatusSchema,
  YouTubeMetadataSchema,
  type YouTubeMetadata,
} from "./index.js";

/**
 * YouTubeMetadata を人間がレビューしやすい Markdown にシリアライズする。
 * 編集可能セクション: title / description / tags / privacy
 * publish 時に再読み込みされ、編集内容が反映される。
 */
export function metadataToDraftMd(meta: YouTubeMetadata, opts?: { jobId?: string }): string {
  const lines: string[] = [];
  lines.push(`# YouTube meta draft${opts?.jobId ? `: ${opts.jobId}` : ""}`);
  lines.push("");
  lines.push("> このファイルを編集してから `pnpm post youtube <jobId>` を実行してください。");
  lines.push("> 編集OK: **title / description / tags / privacy**");
  lines.push("> title は 100字以内、description は 5000字以内、tags の合算 500字以内。");
  lines.push("");

  lines.push("## title");
  lines.push(meta.title);
  lines.push("");

  lines.push("## description");
  lines.push(meta.description);
  lines.push("");

  lines.push("## tags");
  for (const t of meta.tags) lines.push(`- ${t}`);
  if (meta.tags.length === 0) lines.push("<!-- タグを追加してください -->");
  lines.push("");

  lines.push("## privacy");
  lines.push(`<!-- public | unlisted | private -->`);
  lines.push(meta.privacyStatus);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("<!-- 以下はメタ情報（編集しても無視されます） -->");
  lines.push(`- categoryId: ${meta.categoryId}`);
  lines.push(`- containsSyntheticMedia: ${meta.containsSyntheticMedia}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * 編集された meta-draft.md をパースして YouTubeMetadata を復元する。
 * categoryId / containsSyntheticMedia は original を維持（編集させない）。
 */
export function draftMdToMetadata(md: string, original: YouTubeMetadata): YouTubeMetadata {
  const sections = parseSections(md);

  const title = sections.get("title")?.trim() ?? original.title;
  const description = sections.get("description")?.trim() ?? original.description;
  const tagsRaw = sections.get("tags") ?? "";
  const tags = parseBulletList(tagsRaw);
  const privacyRaw = sections.get("privacy")?.trim() ?? original.privacyStatus;
  const privacyStatus = PrivacyStatusSchema.parse(stripComments(privacyRaw).trim());

  return YouTubeMetadataSchema.parse({
    ...original,
    title,
    description,
    tags: tags.length > 0 ? tags : original.tags,
    privacyStatus,
  });
}

function parseSections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = md.split(/\r?\n/);
  let currentName: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentName !== null) out.set(currentName, buffer.join("\n"));
    buffer = [];
  };

  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      currentName = m[1]!.trim();
      continue;
    }
    if (/^---\s*$/.test(line)) {
      flush();
      currentName = null;
      continue;
    }
    if (currentName !== null) buffer.push(line);
  }
  flush();
  return out;
}

function parseBulletList(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--") || trimmed.length === 0) continue;
    const m = /^[-*]\s+(.+?)\s*$/.exec(trimmed);
    if (m) out.push(m[1]!);
  }
  return out;
}

function stripComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "").trim();
}
