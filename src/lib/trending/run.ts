// Server-side pipeline shared by the cron route and scripts/live/trending.mjs.
import {
  ApifyError,
  instagramInput,
  normalizeInstagram,
  normalizeTikTok,
  runActorSync,
  TRENDING_ACTORS,
  tiktokInput,
  type TrendingPost,
} from "./apify";
import { attachCovers } from "./covers";
import { looksLikeRecipe, rankPosts } from "./rank";
import type { Snapshot } from "./store";

export const TIKTOK_HASHTAGS = ["highproteinrecipes", "highproteinmeals", "mealprep"];
export const INSTAGRAM_HASHTAGS = ["highproteinrecipes", "highproteinmeals"];
export const CRON_LIMITS = { tiktok: 60, instagram: 40 };
const RUN_TIMEOUT_SECS = 180;

export type CollectResult = {
  snapshot: Snapshot;
  // Raw dataset items per platform, so the live probe can inspect field names.
  raw: { tiktok: unknown[]; instagram: unknown[] };
  dropped: number; // items the normalizer rejected
  errors: string[];
};

export async function collectTrending(
  limits: { tiktok: number; instagram: number },
  now: Date = new Date(),
  // covers: copy each kept post's thumbnail into Blob (off for probes, which save nothing).
  options: { covers: boolean } = { covers: true },
): Promise<CollectResult> {
  const fetchedAt = now.toISOString();
  const [tt, ig] = await Promise.allSettled([
    runActorSync(TRENDING_ACTORS.tiktok, tiktokInput(TIKTOK_HASHTAGS, limits.tiktok), {
      timeoutSecs: RUN_TIMEOUT_SECS,
      maxItems: limits.tiktok,
    }),
    runActorSync(TRENDING_ACTORS.instagram, instagramInput(INSTAGRAM_HASHTAGS, limits.instagram), {
      timeoutSecs: RUN_TIMEOUT_SECS,
      maxItems: limits.instagram,
    }),
  ]);

  const errors: string[] = [];
  const describe = (e: unknown) => (e instanceof ApifyError || e instanceof Error ? e.message : "unknown error");
  // maxItems is not a hard cap on every run (a probe returned 12 items for maxItems=10), so slice here.
  const rawTikTok = tt.status === "fulfilled" ? tt.value.slice(0, limits.tiktok) : [];
  const rawInstagram = ig.status === "fulfilled" ? ig.value.slice(0, limits.instagram) : [];
  if (tt.status === "rejected") errors.push(`tiktok: ${describe(tt.reason)}`);
  if (ig.status === "rejected") errors.push(`instagram: ${describe(ig.reason)}`);

  const normalized: TrendingPost[] = [];
  let dropped = 0;
  for (const raw of rawTikTok) {
    const post = normalizeTikTok(raw, fetchedAt);
    if (post) normalized.push(post);
    else dropped += 1;
  }
  for (const raw of rawInstagram) {
    const post = normalizeInstagram(raw, fetchedAt);
    if (post) normalized.push(post);
    else dropped += 1;
  }

  const recipeLike = normalized.filter((p) => looksLikeRecipe(p.caption));
  const ranked = rankPosts(recipeLike, { max: 24, now: now.getTime() });
  const posts = options.covers ? await attachCovers(ranked) : ranked;
  const snapshot: Snapshot = {
    generatedAt: fetchedAt,
    hashtags: { tiktok: TIKTOK_HASHTAGS, instagram: INSTAGRAM_HASHTAGS },
    posts,
    stats: {
      fetched: rawTikTok.length + rawInstagram.length,
      keptAsRecipe: recipeLike.length,
      cost: { tiktokItems: rawTikTok.length, instagramItems: rawInstagram.length },
      ...(errors.length ? { errors } : {}),
    },
  };
  return { snapshot, raw: { tiktok: rawTikTok, instagram: rawInstagram }, dropped, errors };
}

// A failed run with no posts must not replace the shelf that is already live.
export function shouldPersist(result: CollectResult): boolean {
  return result.snapshot.posts.length > 0 || result.errors.length === 0;
}
