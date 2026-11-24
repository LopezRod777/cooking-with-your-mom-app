import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { attachCovers, coverPath } from "../trending/covers";
import type { TrendingPost } from "../trending/apify";

const base = (id: string, cover?: string): TrendingPost => ({
  id,
  platform: "tiktok",
  url: `https://www.tiktok.com/@a/video/${id}`,
  author: "a",
  caption: "c",
  likes: 1,
  comments: 0,
  fetchedAt: "2026-11-01T00:00:00.000Z",
  ...(cover ? { cover } : {}),
});

describe("attachCovers", () => {
  it("stores a resized JPEG per post with a cover and leaves the others untouched", async () => {
    const png = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#aa3322" } }).png().toBuffer();
    const stored: { path: string; width: number }[] = [];
    const out = await attachCovers([base("1", "https://cdn/x.png"), base("2"), base("3", "https://cdn/missing.png")], {
      download: async (url) => (url.endsWith("x.png") ? png : null),
      store: async (path, jpeg) => {
        const meta = await sharp(jpeg).metadata();
        stored.push({ path, width: meta.width ?? 0 });
        return `https://blob.example/${path}`;
      },
    });
    expect(stored).toEqual([{ path: "trending/covers/tiktok-1.jpg", width: 720 }]);
    expect(out[0].image).toBe("https://blob.example/trending/covers/tiktok-1.jpg");
    expect(out[1].image).toBeUndefined();
    expect(out[2].image).toBeUndefined();
    expect(out[0].cover).toBe("https://cdn/x.png");
  });

  it("a failing download or store never throws", async () => {
    const out = await attachCovers([base("9", "https://cdn/boom.jpg")], {
      download: async () => {
        throw new Error("network");
      },
      store: async () => "unused",
    });
    expect(out[0].image).toBeUndefined();
  });

  it("coverPath strips unsafe id characters", () => {
    expect(coverPath({ platform: "instagram", id: "ab/..c" })).toBe("trending/covers/instagram-abc.jpg");
  });
});
