import fs from "node:fs/promises";
import path from "node:path";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "rekishi-shorts/0.1 (contact: local dev)";

/** CC / PD 系ライセンスのみ許可 */
const ALLOWED_LICENSE_SUBSTRINGS = [
  "cc-by",
  "cc-zero",
  "public domain",
  "publicdomain",
  "pd-",
];

function isAllowedLicense(licenseShortName: string | undefined): boolean {
  if (!licenseShortName) return false;
  const lower = licenseShortName.toLowerCase();
  return ALLOWED_LICENSE_SUBSTRINGS.some((s) => lower.includes(s));
}

interface CommonsImageInfo {
  url: string;
  descriptionurl: string;
  width: number;
  height: number;
  extmetadata?: {
    LicenseShortName?: { value?: string };
    Artist?: { value?: string };
    ImageDescription?: { value?: string };
  };
}

interface CommonsPage {
  title: string;
  imageinfo?: CommonsImageInfo[];
}

export interface WikimediaImage {
  /** Commons ページURL */
  pageUrl: string;
  /** 直接DL可能な画像URL */
  imageUrl: string;
  width: number;
  height: number;
  license: string;
  attribution?: string;
}

/**
 * Wikimedia Commons を検索し、CC/PDライセンスの画像候補を返す。
 * 見つからなければ空配列。
 */
export async function searchWikimediaImages(
  query: string,
  opts: { limit?: number } = {},
): Promise<WikimediaImage[]> {
  const limit = opts.limit ?? 10;
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap|drawing`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "1600",
    origin: "*",
  });

  const res = await fetch(`${COMMONS_API}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Wikimedia search failed: ${res.status}`);
  const json = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };

  const pages = json.query?.pages;
  if (!pages) return [];

  const results: WikimediaImage[] = [];
  for (const page of Object.values(pages)) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const license = info.extmetadata?.LicenseShortName?.value ?? "";
    if (!isAllowedLicense(license)) continue;
    results.push({
      pageUrl: info.descriptionurl,
      imageUrl: info.url,
      width: info.width,
      height: info.height,
      license,
      attribution: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "").trim(),
    });
  }
  return results;
}

/**
 * 画像URLからダウンロードしてローカルに保存する。
 */
export async function downloadImage(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Image download failed ${res.status}: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buffer);
}
