import { describe, expect, it } from "vitest";
import type { TrendingPost } from "../trending/apify";
import { looksLikeRecipe, rankPosts, score, titleFrom } from "../trending/rank";
import { compactCount, statLine } from "../trending/format";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const DAY = 86_400_000;
const recipeCaption = "High protein bowl\n200g chicken\n1 cup rice\n2 tbsp soy sauce";

function post(over: Partial<TrendingPost> & { id: string }): TrendingPost {
  return {
    platform: "tiktok",
    url: `https://www.tiktok.com/@${over.author ?? "cook"}/video/${over.id}`,
    author: "cook",
    caption: recipeCaption,
    likes: 100,
    comments: 0,
    fetchedAt: "2026-10-30T12:00:00.000Z",
    postedAt: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}

describe("looksLikeRecipe", () => {
  it("accepts 3 or more measured quantities", () => {
    expect(looksLikeRecipe("200g chicken, 1 cup rice, 2 tbsp oil")).toBe(true);
    expect(looksLikeRecipe("3 eggs, 2 scoops whey, 1.5 oz cheese")).toBe(true);
  });
  it("rejects 2 quantities and plain chat", () => {
    expect(looksLikeRecipe("200g chicken and 1 cup rice, that's my lunch")).toBe(false);
    expect(looksLikeRecipe("I lost 70 lbs, you can too!")).toBe(false);
  });
  it("accepts an ingredient list of 4 or more lines", () => {
    expect(looksLikeRecipe("Ingredients:\n- chicken\n- rice\n- beans\n- lime")).toBe(true);
    expect(looksLikeRecipe("• a\n• b\n• c")).toBe(false);
  });
});

describe("score", () => {
  it("weights comments 3x and shares 2x", () => {
    const base = post({ id: "a", likes: 10, comments: 0, postedAt: undefined });
    expect(score({ ...base, comments: 10 }, NOW)).toBeCloseTo(score({ ...base, likes: 40 }, NOW));
    expect(score({ ...base, shares: 5 }, NOW)).toBeCloseTo(score({ ...base, likes: 20 }, NOW));
  });
  it("divides by the square root of age in days, with a floor of one day", () => {
    const fresh = score(post({ id: "a", likes: 1000, postedAt: new Date(NOW).toISOString() }), NOW);
    const oneDay = score(post({ id: "a", likes: 1000, postedAt: new Date(NOW - DAY).toISOString() }), NOW);
    const fourDays = score(post({ id: "a", likes: 1000, postedAt: new Date(NOW - 4 * DAY).toISOString() }), NOW);
    expect(fresh).toBe(oneDay);
    expect(fourDays).toBeCloseTo(oneDay / 2);
  });
  it("scores a post without a date as one week old", () => {
    const unknown = score(post({ id: "a", likes: 700, postedAt: undefined }), NOW);
    expect(unknown).toBeCloseTo(700 / Math.sqrt(7));
  });
});

describe("rankPosts", () => {
  it("drops non-recipes, duplicate urls, and sorts by score", () => {
    const ranked = rankPosts(
      [
        post({ id: "low", likes: 50 }),
        post({ id: "high", likes: 5000, author: "other" }),
        post({ id: "chat", likes: 99999, caption: "so good, love it" }),
        post({ id: "dupe", likes: 5000, author: "other", url: "https://www.tiktok.com/@other/video/high" }),
      ],
      { now: NOW },
    );
    expect(ranked.map((p) => p.id)).toEqual(["high", "low"]);
  });
  it("keeps at most two posts per author", () => {
    const posts = [1, 2, 3, 4].map((n) => post({ id: `p${n}`, author: "Same", likes: n * 100 }));
    expect(rankPosts(posts, { now: NOW }).map((p) => p.id)).toEqual(["p4", "p3"]);
  });
  it("caps the result at max", () => {
    const posts = Array.from({ length: 30 }, (_, i) => post({ id: `x${i}`, author: `a${i}`, likes: i }));
    expect(rankPosts(posts, { max: 24, now: NOW })).toHaveLength(24);
  });
});

describe("titleFrom", () => {
  it("uses the first line with words, without hashtags or emoji", () => {
    expect(titleFrom("🔥🔥\n#highprotein #mealprep\nCrispy chicken bowl 🍗 #fyp")).toBe("Crispy chicken bowl");
  });
  it("caps long titles at 60 characters on a word boundary", () => {
    const title = titleFrom("High protein chicken shawarma bowl with garlic yogurt sauce and crispy pita chips for dinner");
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("High protein chicken shawarma bowl with garlic yogurt")).toBe(true);
  });
  it("falls back when there are no words", () => {
    expect(titleFrom("#highprotein 🔥")).toBe("Untitled recipe");
  });
});

describe("compactCount and statLine", () => {
  it("formats counts with k and M", () => {
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1234)).toBe("1.2k");
    expect(compactCount(2100)).toBe("2.1k");
    expect(compactCount(128000)).toBe("128k");
    expect(compactCount(9960)).toBe("10k");
    expect(compactCount(1_500_000)).toBe("1.5M");
    expect(compactCount(999_950)).toBe("1M");
  });
  it("writes the shelf stat line", () => {
    expect(statLine({ likes: 128000, comments: 2100 })).toBe("128k likes · 2.1k comments");
    expect(statLine({ likes: 1, comments: 1 })).toBe("1 like · 1 comment");
  });
});
