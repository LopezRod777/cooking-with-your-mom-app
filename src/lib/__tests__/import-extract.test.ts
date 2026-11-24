import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cleanText,
  detectPlatform,
  extractBalancedObject,
  extractSource,
  instagramFromPage,
  normalizeUrl,
  parseJsonLdRecipe,
  parseOg,
  parseTikTok,
  parseYouTubeDescription,
  tiktokFromPage,
  webFromPage,
  youtubeFromPage,
  type Page,
} from "../import/extract";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/import/${name}`, import.meta.url), "utf8");

const page = (over: Partial<Page> & { html?: string }): Page => ({
  status: 200,
  finalUrl: "https://example.com/post",
  html: "",
  cfMitigated: false,
  ...over,
});

describe("normalizeUrl and detectPlatform", () => {
  it("adds https when the scheme is missing and rejects non-http schemes", () => {
    expect(normalizeUrl("tiktok.com/@x/video/1")).toBe("https://tiktok.com/@x/video/1");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("classifies the four supported sources", () => {
    expect(detectPlatform("https://www.tiktok.com/@doosifit/video/7183118805290339627")).toBe("tiktok");
    expect(detectPlatform("https://vm.tiktok.com/ZMabc/")).toBe("tiktok");
    expect(detectPlatform("https://youtu.be/abc123XYZ00")).toBe("youtube");
    expect(detectPlatform("https://m.youtube.com/watch?v=abc123XYZ00")).toBe("youtube");
    expect(detectPlatform("https://www.instagram.com/reel/abc/")).toBe("instagram");
    expect(detectPlatform("https://www.recipetineats.com/baked-fish/")).toBe("web");
  });

  it("refuses internal hosts without touching the network", async () => {
    const res = await extractSource("http://localhost:3000/secret");
    expect(res).toMatchObject({ ok: false, reason: "bad_url" });
    const lan = await extractSource("http://192.168.1.10/recipe");
    expect(lan).toMatchObject({ ok: false, reason: "bad_url" });
  });
});

describe("cleanText", () => {
  it("strips tags, decodes entities, collapses spaces and caps at 6000 chars", () => {
    expect(cleanText("<p>Salt &amp; <b>pepper</b>&nbsp;&nbsp;now</p>")).toBe("Salt & pepper now");
    expect(cleanText("   ")).toBeUndefined();
    expect(cleanText("a".repeat(7000))?.length).toBe(6000);
  });
});

describe("extractBalancedObject", () => {
  it("skips braces and escaped quotes inside JSON strings", () => {
    const src = 'x = {"a":"} not a close \\" {","b":{"c":1}}; y';
    expect(extractBalancedObject(src, src.indexOf("{"))).toBe('{"a":"} not a close \\" {","b":{"c":1}}');
  });
});

describe("parseTikTok", () => {
  it("reads caption, author and cover from the rehydration JSON", () => {
    const data = parseTikTok(fixture("tiktok-post.html"));
    expect(data?.author).toBe("doosi");
    expect(data?.image).toBe("https://p16-sign.example.com/cover.jpeg");
    expect(data?.text).toContain('5 min high protein chicken bowl "meal prep" 35g protein');
    expect(data?.text).toContain("2 chicken breasts, 1 cup rice");
  });

  it("returns null when the rehydration script is missing", () => {
    expect(parseTikTok("<html><body>captcha</body></html>")).toBeNull();
  });

  it("maps a TikTok page to ok with the caption", () => {
    const res = tiktokFromPage(page({ html: fixture("tiktok-post.html"), finalUrl: "https://www.tiktok.com/@doosifit/video/1" }), "x");
    expect(res).toMatchObject({ platform: "tiktok", ok: true, author: "doosi" });
    expect(res.text?.length).toBeGreaterThan(40);
  });

  it("reports blocked for a challenge response", () => {
    expect(tiktokFromPage(page({ status: 403 }), "https://www.tiktok.com/@x/video/1")).toMatchObject({
      ok: false,
      reason: "blocked",
    });
  });
});

describe("parseYouTubeDescription", () => {
  it("returns the full shortDescription even when it contains braces, quotes and entities", () => {
    const text = parseYouTubeDescription(fixture("youtube-watch.html"));
    expect(text).toContain('{or quinoa} "fluffed"');
    expect(text).toContain("Steps: whisk the eggs; cook the rice.");
    expect(text).toContain("https://example.com/recipe?x=1&y=2");
  });

  it("maps title and author from oEmbed when present", () => {
    const res = youtubeFromPage(
      page({ html: fixture("youtube-watch.html") }),
      { title: "Easy Chicken Bowl (oEmbed)", author_name: "Test Chef", thumbnail_url: "https://i.ytimg.com/vi/x/hq.jpg" },
      "https://www.youtube.com/watch?v=abc123XYZ00",
    );
    expect(res).toMatchObject({ ok: true, title: "Easy Chicken Bowl (oEmbed)", author: "Test Chef" });
    expect(res.text).toBeDefined();
  });
});

describe("parseJsonLdRecipe", () => {
  it("finds the Recipe inside @graph and flattens instructions in order", () => {
    const r = parseJsonLdRecipe(fixture("blog-recipe.html"));
    expect(r?.title).toBe("Baked Fish with Lemon Cream Sauce");
    expect(r?.author).toBe("Nagi | Example Eats");
    expect(r?.image).toBe("https://www.example-recipes.com/images/fish-1x1.jpg");
    expect(r?.ratingValue).toBe(4.97);
    expect(r?.ratingCount).toBe(647);
    const lines = r?.text?.split("\n") ?? [];
    expect(lines[0]).toBe("Ingredients:");
    expect(lines).toContain("- Salt & pepper");
    const steps = lines.filter((l) => /^\d+\./.test(l));
    expect(steps).toEqual([
      "1. Heat the oven to 200°C.",
      "2. Melt the butter and add the cream.",
      "3. Stir in the lemon juice and simmer 2 minutes.",
      "4. Bake the fish 12 to 15 minutes until it flakes.",
    ]);
  });

  it("returns null when there is no Recipe node", () => {
    expect(parseJsonLdRecipe('<script type="application/ld+json">{"@type":"Article"}</script>')).toBeNull();
  });

  it("maps a blog page to ok with rating; a one-line og summary alone is not accepted", () => {
    const ok = webFromPage(page({ html: fixture("blog-recipe.html"), finalUrl: "https://www.example-recipes.com/fish/" }), "x");
    expect(ok).toMatchObject({ ok: true, ratingValue: 4.97, ratingCount: 647, platform: "web" });

    const og = webFromPage(
      page({ html: '<title>Plain page</title><meta property="og:description" content="A short description of soup.">' }),
      "https://example.com/soup",
    );
    expect(og).toMatchObject({ ok: false, reason: "web_summary_only", title: "Plain page" });
  });

  it("accepts a recipe-shaped page without JSON-LD (article text with quantities and numbered steps)", () => {
    const res = webFromPage(page({ html: fixture("recipe-article-steps.html") }), "https://example.com/bowls");
    expect(res).toMatchObject({ ok: true, title: "Lemon chicken rice bowls", platform: "web" });
    expect(res.text).toContain("1. Rinse the rice");
    expect(res.text?.length).toBeGreaterThanOrEqual(300);
  });

  it("returns web_summary_only for a one-paragraph summary without JSON-LD", () => {
    const res = webFromPage(page({ html: fixture("recipe-summary-only.html") }), "https://example.com/soup");
    expect(res).toMatchObject({ ok: false, reason: "web_summary_only", title: "Quick soup" });
    expect(res.text).toBeUndefined();
  });

  it("reports blocked for a Cloudflare challenge", () => {
    const res = webFromPage(page({ status: 403, cfMitigated: true, html: "<title>Just a moment...</title>" }), "https://www.seriouseats.com/x");
    expect(res).toMatchObject({ ok: false, reason: "blocked" });
  });
});

describe("parseOg", () => {
  it("reads og title, description and image", () => {
    const og = parseOg(fixture("blog-recipe.html"));
    expect(og).toMatchObject({
      title: "Baked Fish with Lemon Cream Sauce",
      description: "Flaky fish in a lemon cream sauce.",
      image: "https://www.example-recipes.com/images/fish.jpg",
    });
  });
});

describe("instagramFromPage", () => {
  it("sends a login redirect to needs-text", () => {
    const res = instagramFromPage(
      page({
        finalUrl: "https://www.instagram.com/accounts/login/?next=%2Freel%2Fabc%2F",
        html: fixture("instagram-login.html"),
      }),
      "https://www.instagram.com/reel/abc/",
    );
    expect(res).toMatchObject({ ok: false, reason: "instagram_needs_text", platform: "instagram" });
  });

  it("sends a page without og:description to needs-text", () => {
    const res = instagramFromPage(page({ html: fixture("instagram-login.html") }), "https://www.instagram.com/reel/abc/");
    expect(res).toMatchObject({ ok: false, reason: "instagram_needs_text" });
  });

  it("reads og:description when the post is public", () => {
    const html =
      '<meta property="og:title" content="chef on Instagram: &quot;Two eggs and rice&quot;"><meta property="og:description" content="2 eggs, 1 cup rice. Fry the rice, crack the eggs on top.">';
    const res = instagramFromPage(page({ html, finalUrl: "https://www.instagram.com/reel/abc/" }), "x");
    expect(res).toMatchObject({ ok: true, author: "chef", text: "2 eggs, 1 cup rice. Fry the rice, crack the eggs on top." });
  });
});
