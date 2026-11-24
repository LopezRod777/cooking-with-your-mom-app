import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTrending, shouldPersist } from "../trending/run";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const recipe = "Protein bowl\n200g chicken\n1 cup rice\n2 tbsp soy sauce";

const ttItem = {
  id: "1",
  text: recipe,
  createTimeISO: "2026-10-29T12:00:00.000Z",
  webVideoUrl: "https://www.tiktok.com/@chef/video/1",
  authorMeta: { name: "chef" },
  diggCount: 5000,
  commentCount: 100,
};
const igItem = {
  id: "2",
  url: "https://www.instagram.com/p/AAA/",
  caption: recipe,
  likesCount: 800,
  commentsCount: 20,
  timestamp: "2026-10-29T12:00:00.000Z",
  ownerUsername: "cook",
};

// Routes each actor call to a canned response, based on the actor id in the URL.
function stubApify(responses: { tiktok: () => Response; instagram: () => Response }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("clockworks~tiktok-hashtag-scraper")) return responses.tiktok();
      if (url.includes("apify~instagram-hashtag-scraper")) return responses.instagram();
      throw new Error(`unexpected url ${url}`);
    }),
  );
}
const ok = (items: unknown[]) => () => new Response(JSON.stringify(items), { status: 201 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("collectTrending", () => {
  it("ranks both platforms and counts items per platform", async () => {
    vi.stubEnv("APIFY_TOKEN", "test-token");
    stubApify({ tiktok: ok([ttItem]), instagram: ok([igItem]) });
    const result = await collectTrending({ tiktok: 10, instagram: 10 }, NOW);
    expect(result.snapshot.stats).toEqual({
      fetched: 2,
      keptAsRecipe: 2,
      cost: { tiktokItems: 1, instagramItems: 1 },
    });
    expect(result.snapshot.posts.map((p) => p.platform)).toEqual(["tiktok", "instagram"]);
    expect(result.errors).toEqual([]);
    expect(shouldPersist(result)).toBe(true);
  });

  it("keeps the platform that worked when the other fails, and reports the error text", async () => {
    vi.stubEnv("APIFY_TOKEN", "test-token");
    stubApify({
      tiktok: () => new Response("actor exploded", { status: 500 }),
      instagram: ok([igItem]),
    });
    const result = await collectTrending({ tiktok: 10, instagram: 10 }, NOW);
    expect(result.snapshot.posts).toHaveLength(1);
    expect(result.snapshot.stats.errors?.[0]).toContain("tiktok:");
    expect(result.snapshot.stats.errors?.[0]).toContain("HTTP 500");
    expect(result.snapshot.stats.cost).toEqual({ tiktokItems: 0, instagramItems: 1 });
    expect(shouldPersist(result)).toBe(true);
  });

  it("does not persist an empty result when both platforms failed", async () => {
    vi.stubEnv("APIFY_TOKEN", "test-token");
    stubApify({
      tiktok: () => new Response("down", { status: 503 }),
      instagram: () => new Response("down", { status: 503 }),
    });
    const result = await collectTrending({ tiktok: 10, instagram: 10 }, NOW);
    expect(result.snapshot.posts).toEqual([]);
    expect(result.snapshot.stats.errors).toHaveLength(2);
    expect(shouldPersist(result)).toBe(false);
  });
});
