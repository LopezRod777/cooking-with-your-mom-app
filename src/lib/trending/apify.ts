// Apify hashtag scrapers -> TrendingPost. Server-only (and Node for scripts/live/trending.mjs).
import { z } from "zod";

export const TRENDING_ACTORS = {
  tiktok: "clockworks~tiktok-hashtag-scraper",
  instagram: "apify~instagram-hashtag-scraper",
} as const;

// Input fields, read from GET /v2/acts/<id>/builds/default -> actorDefinition.input (2026-10-30):
//   clockworks/tiktok-hashtag-scraper  required: hashtags (string[]); resultsPerPage (int, PER hashtag, default 100);
//                                      shouldDownloadVideos / shouldDownloadCovers / shouldDownloadSlideshowImages (bool, default false).
//   apify/instagram-hashtag-scraper    required: hashtags (string[]); resultsLimit (int, PER hashtag);
//                                      resultsType (enum "posts" | "reels" | "stories"). We use "reels": the TikTok-style video feed.
// Limits are per hashtag, so the total is split evenly across hashtags below.
export type TikTokInput = {
  hashtags: string[];
  resultsPerPage: number;
  shouldDownloadVideos: false;
  shouldDownloadCovers: false;
  shouldDownloadSlideshowImages: false;
};
export type InstagramInput = { hashtags: string[]; resultsLimit: number; resultsType: "reels" };

export const tiktokInput = (hashtags: string[], total: number): TikTokInput => ({
  hashtags,
  resultsPerPage: Math.max(1, Math.ceil(total / hashtags.length)),
  shouldDownloadVideos: false,
  shouldDownloadCovers: false,
  shouldDownloadSlideshowImages: false,
});

export const instagramInput = (hashtags: string[], total: number): InstagramInput => ({
  hashtags,
  resultsLimit: Math.max(1, Math.ceil(total / hashtags.length)),
  resultsType: "reels",
});

export const TrendingPost = z.object({
  id: z.string().min(1),
  platform: z.enum(["tiktok", "instagram"]),
  url: z.url(),
  author: z.string().min(1),
  authorUrl: z.url().optional(),
  caption: z.string(),
  likes: z.number().int().min(0),
  comments: z.number().int().min(0),
  plays: z.number().int().min(0).optional(),
  shares: z.number().int().min(0).optional(),
  postedAt: z.iso.datetime().optional(),
  fetchedAt: z.iso.datetime(),
  // Source thumbnail (platform CDN, short-lived) and our copy of it in Blob (what the cards show).
  cover: z.url().optional(),
  image: z.url().optional(),
});
export type TrendingPost = z.infer<typeof TrendingPost>;

export class ApifyError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApifyError";
    this.status = status;
  }
}

// POST /v2/acts/<id>/run-sync-get-dataset-items: runs the actor and returns its dataset items in one call.
export async function runActorSync(
  actorId: string,
  input: Record<string, unknown>,
  opts: { timeoutSecs: number; maxItems: number },
): Promise<unknown[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new ApifyError("APIFY_TOKEN is not set");
  const qs = new URLSearchParams({
    timeout: String(opts.timeoutSecs),
    memory: "1024",
    maxItems: String(opts.maxItems),
  });
  const res = await fetch(`https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?${qs}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((opts.timeoutSecs + 30) * 1000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new ApifyError(`${actorId} failed: HTTP ${res.status} ${body}`, res.status);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new ApifyError(`${actorId} returned no dataset array`);
  return data;
}

const nonNeg = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? 0 : Math.max(0, Math.round(n)));
const isoOrUndef = (s: string | undefined) => (s && z.iso.datetime().safeParse(s).success ? s : undefined);

// Fields below were checked against a real run on 2026-10-30 (10-12 items per platform, scripts/live/trending.mjs
// and a one-off probe). Marked [run] = present in a live item. Others are documented in the actor README only.
const TikTokItem = z
  .object({
    id: z.union([z.string(), z.number()]), // [run]
    text: z.string().optional(), // [run] caption
    createTimeISO: z.string().optional(), // [run]
    webVideoUrl: z.string().optional(), // [run]
    authorMeta: z // [run]
      .object({ name: z.string().optional(), profileUrl: z.string().optional() })
      .optional(),
    diggCount: z.number().optional(), // [run] likes
    commentCount: z.number().optional(), // [run]
    shareCount: z.number().optional(), // [run]
    playCount: z.number().optional(), // [run]
    videoMeta: z // [run] (object; cover fields per the actor README)
      .object({ coverUrl: z.string().optional(), originalCoverUrl: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

// Fields below were checked against a real run on 2026-10-30. [run] = present in a live item.
const InstagramItem = z
  .object({
    id: z.union([z.string(), z.number()]), // [run]
    shortCode: z.string().optional(), // [run]
    caption: z.string().optional(), // [run]
    url: z.string().optional(), // [run]
    likesCount: z.number().optional(), // [run] (can be -1 when likes are hidden: clamped to 0)
    commentsCount: z.number().optional(), // [run]
    sharesCount: z.number().optional(), // [run]
    videoPlayCount: z.number().optional(), // [run]
    igPlayCount: z.number().optional(), // [run]
    timestamp: z.string().optional(), // [run]
    ownerUsername: z.string().optional(), // [run]
    displayUrl: z.string().optional(), // [run] thumbnail
    images: z.array(z.string()).optional(), // [run]
  })
  .passthrough();

// Only https URLs count as a thumbnail source.
function httpsOrUndef(...candidates: (string | undefined)[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && /^https:\/\//.test(c)) return c;
  }
  return undefined;
}

const withCover = (cover: string | undefined) => (cover === undefined ? {} : { cover });

export function normalizeTikTok(raw: unknown, fetchedAt: string): TrendingPost | null {
  const parsed = TikTokItem.safeParse(raw);
  if (!parsed.success) return null;
  const it = parsed.data;
  const author = it.authorMeta?.name?.trim();
  if (!author) return null;
  const id = String(it.id);
  const post = {
    id,
    platform: "tiktok" as const,
    url: it.webVideoUrl || `https://www.tiktok.com/@${author}/video/${id}`,
    author,
    authorUrl: it.authorMeta?.profileUrl || `https://www.tiktok.com/@${author}`,
    caption: it.text ?? "",
    likes: nonNeg(it.diggCount),
    comments: nonNeg(it.commentCount),
    plays: it.playCount === undefined ? undefined : nonNeg(it.playCount),
    shares: it.shareCount === undefined ? undefined : nonNeg(it.shareCount),
    postedAt: isoOrUndef(it.createTimeISO),
    fetchedAt,
    ...withCover(httpsOrUndef(it.videoMeta?.coverUrl, it.videoMeta?.originalCoverUrl)),
  };
  return TrendingPost.safeParse(post).success ? TrendingPost.parse(post) : null;
}

export function normalizeInstagram(raw: unknown, fetchedAt: string): TrendingPost | null {
  const parsed = InstagramItem.safeParse(raw);
  if (!parsed.success) return null;
  const it = parsed.data;
  const author = it.ownerUsername?.trim();
  if (!author) return null;
  const id = String(it.id);
  const url = it.url || (it.shortCode ? `https://www.instagram.com/reel/${it.shortCode}/` : "");
  const plays = it.videoPlayCount ?? it.igPlayCount;
  const post = {
    id,
    platform: "instagram" as const,
    url,
    author,
    authorUrl: `https://www.instagram.com/${author}/`,
    caption: it.caption ?? "",
    likes: nonNeg(it.likesCount),
    comments: nonNeg(it.commentsCount),
    plays: plays === undefined ? undefined : nonNeg(plays),
    shares: it.sharesCount === undefined ? undefined : nonNeg(it.sharesCount),
    postedAt: isoOrUndef(it.timestamp),
    fetchedAt,
    ...withCover(httpsOrUndef(it.displayUrl, it.images?.[0])),
  };
  return TrendingPost.safeParse(post).success ? TrendingPost.parse(post) : null;
}
