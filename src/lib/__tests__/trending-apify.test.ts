// Normalizers for the two Apify hashtag actors. Every field used below appeared in a real item
// from a live run on 2026-10-30 (scripts/live/trending.mjs probe, 10 items per platform).
// The sample items are hand-written from those field names, not copied from the run.
import { describe, expect, it } from "vitest";
import { instagramInput, normalizeInstagram, normalizeTikTok, tiktokInput } from "../trending/apify";

const NOW = "2026-10-30T12:00:00.000Z";

describe("normalizeTikTok", () => {
  const ttA = {
    id: "7694690164265815310",
    text: "Steak & Queso Street Corn Bowl\n\n#highprotein #mealprep",
    createTimeISO: "2026-10-09T15:28:22.000Z",
    webVideoUrl: "https://www.tiktok.com/@hunt4shredz/video/7694690164265815310",
    authorMeta: { name: "hunt4shredz", profileUrl: "https://www.tiktok.com/@hunt4shredz" },
    diggCount: 330400,
    commentCount: 590,
    shareCount: 4100,
    playCount: 5200000,
  };

  it("maps a full item to TrendingPost", () => {
    expect(normalizeTikTok(ttA, NOW)).toEqual({
      id: "7694690164265815310",
      platform: "tiktok",
      url: "https://www.tiktok.com/@hunt4shredz/video/7694690164265815310",
      author: "hunt4shredz",
      authorUrl: "https://www.tiktok.com/@hunt4shredz",
      caption: "Steak & Queso Street Corn Bowl\n\n#highprotein #mealprep",
      likes: 330400,
      comments: 590,
      plays: 5200000,
      shares: 4100,
      postedAt: "2026-10-09T15:28:22.000Z",
      fetchedAt: NOW,
    });
  });

  it("builds the URL from author and id when webVideoUrl is missing, and drops an unparseable date", () => {
    const post = normalizeTikTok(
      { id: 42, text: "Chicken bowl", authorMeta: { name: "chef" }, diggCount: 5, createTimeISO: "not a date" },
      NOW,
    );
    expect(post?.url).toBe("https://www.tiktok.com/@chef/video/42");
    expect(post?.id).toBe("42");
    expect(post?.postedAt).toBeUndefined();
    expect(post?.comments).toBe(0);
    expect(post?.plays).toBeUndefined();
  });

  it("rejects an item with no author to credit", () => {
    expect(normalizeTikTok({ id: "1", text: "x", diggCount: 1 }, NOW)).toBeNull();
    expect(normalizeTikTok({ id: "1", authorMeta: { name: "  " } }, NOW)).toBeNull();
  });
});

describe("normalizeInstagram", () => {
  const igA = {
    id: "4008444456578499085",
    shortCode: "Deg2v7gPsIN",
    caption: "7 high-protein recipes\n2 cups rice\n1 tbsp soy sauce\n200g chicken",
    url: "https://www.instagram.com/p/Deg2v7gPsIN/",
    likesCount: 875,
    commentsCount: 97,
    sharesCount: 770,
    videoPlayCount: 91577,
    igPlayCount: 91577,
    timestamp: "2026-10-15T11:31:53.000Z",
    ownerUsername: "learnlively",
    productType: "clips",
  };

  it("maps a full reel to TrendingPost", () => {
    expect(normalizeInstagram(igA, NOW)).toEqual({
      id: "4008444456578499085",
      platform: "instagram",
      url: "https://www.instagram.com/p/Deg2v7gPsIN/",
      author: "learnlively",
      authorUrl: "https://www.instagram.com/learnlively/",
      caption: igA.caption,
      likes: 875,
      comments: 97,
      plays: 91577,
      shares: 770,
      postedAt: "2026-10-15T11:31:53.000Z",
      fetchedAt: NOW,
    });
  });

  it("clamps hidden likes (-1) to 0 and builds a reel URL from shortCode when url is missing", () => {
    const post = normalizeInstagram(
      { id: "9", shortCode: "ABC123", caption: "Protein bowl", likesCount: -1, commentsCount: 3, ownerUsername: "cook" },
      NOW,
    );
    expect(post?.likes).toBe(0);
    expect(post?.url).toBe("https://www.instagram.com/reel/ABC123/");
    expect(post?.shares).toBeUndefined();
  });

  it("rejects an item with no owner", () => {
    expect(normalizeInstagram({ id: "1", url: "https://www.instagram.com/p/x/" }, NOW)).toBeNull();
  });
});

describe("actor inputs", () => {
  it("splits the total evenly across hashtags, rounding up", () => {
    expect(tiktokInput(["a", "b", "c"], 60)).toMatchObject({ hashtags: ["a", "b", "c"], resultsPerPage: 20 });
    expect(tiktokInput(["a", "b", "c"], 10)).toMatchObject({ resultsPerPage: 4 });
    expect(instagramInput(["a", "b"], 40)).toEqual({ hashtags: ["a", "b"], resultsLimit: 20, resultsType: "reels" });
  });
});

describe("thumbnails", () => {
  it("TikTok keeps an https cover from videoMeta; Instagram from displayUrl", () => {
    const tt = normalizeTikTok(
      { id: 1, authorMeta: { name: "a" }, text: "x", videoMeta: { coverUrl: "https://cdn.example/cover.jpg" } },
      NOW,
    );
    expect(tt?.cover).toBe("https://cdn.example/cover.jpg");
    const ig = normalizeInstagram({ id: 2, ownerUsername: "b", caption: "y", url: "https://www.instagram.com/p/x/", displayUrl: "https://cdn.example/d.jpg" }, NOW);
    expect(ig?.cover).toBe("https://cdn.example/d.jpg");
    const plain = normalizeTikTok({ id: 3, authorMeta: { name: "c" }, text: "z", videoMeta: { coverUrl: "http://insecure/c.jpg" } }, NOW);
    expect(plain?.cover).toBeUndefined();
    expect(Object.keys(plain ?? {})).not.toContain("cover");
  });
});
