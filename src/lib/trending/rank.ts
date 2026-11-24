// Pure: which posts look like recipes, how they score, and how the shelf is ordered.
import type { TrendingPost } from "./apify";

const QUANTITY = /\b\d+(\.\d+)?\s*(g|oz|lb|lbs|cup|cups|tbsp|tsp|cloves?|eggs?|scoops?)\b/gi;
const LIST_LINE = /^\s*(?:[-•]|\d)/;
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|️|‍/gu;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const MAX_PER_AUTHOR = 2;
const UNKNOWN_AGE_DAYS = 7; // posts without postedAt are scored as one week old, not as brand new.

// A caption is a recipe when it names 3+ measured quantities, or has a list of 4+ ingredient-looking lines.
export function looksLikeRecipe(caption: string): boolean {
  const quantities = caption.match(QUANTITY)?.length ?? 0;
  if (quantities >= 3) return true;
  const listLines = caption.split(/\r?\n/).filter((line) => LIST_LINE.test(line)).length;
  return listLines >= 4;
}

// Engagement per square root of age: a 2-day-old post with 1k likes outranks a 60-day-old one with 3k.
export function score(post: TrendingPost, now: number = Date.now()): number {
  const ageDays = post.postedAt ? Math.max(0, (now - Date.parse(post.postedAt)) / 86_400_000) : UNKNOWN_AGE_DAYS;
  const engagement = post.likes + 3 * post.comments + 2 * (post.shares ?? 0);
  return engagement / Math.sqrt(Math.max(1, ageDays));
}

export function rankPosts(posts: TrendingPost[], opts: { max?: number; now?: number } = {}): TrendingPost[] {
  const max = opts.max ?? 24;
  const now = opts.now ?? Date.now();
  const seenUrls = new Set<string>();
  const unique = posts.filter((p) => {
    if (seenUrls.has(p.url)) return false;
    seenUrls.add(p.url);
    return true;
  });
  const sorted = unique
    .filter((p) => looksLikeRecipe(p.caption))
    .map((post) => ({ post, s: score(post, now) }))
    .sort((a, b) => b.s - a.s || a.post.id.localeCompare(b.post.id))
    .map((x) => x.post);

  const perAuthor = new Map<string, number>();
  const out: TrendingPost[] = [];
  for (const post of sorted) {
    if (out.length >= max) break;
    const key = post.author.toLowerCase();
    const count = perAuthor.get(key) ?? 0;
    if (count >= MAX_PER_AUTHOR) continue;
    perAuthor.set(key, count + 1);
    out.push(post);
  }
  return out;
}

// Short shelf title from the first line that has words in it. Hashtags and emoji are dropped.
export function titleFrom(caption: string): string {
  for (const line of caption.split(/\r?\n/)) {
    const cleaned = line
      .replace(HASHTAG, " ")
      .replace(EMOJI, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[\s\-–—:|•·]+|[\s\-–—:|•·]+$/g, "");
    if (!/\p{L}/u.test(cleaned)) continue;
    if (cleaned.length <= 60) return cleaned;
    const cut = cleaned.slice(0, 59);
    const space = cut.lastIndexOf(" ");
    return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return "Untitled recipe";
}
