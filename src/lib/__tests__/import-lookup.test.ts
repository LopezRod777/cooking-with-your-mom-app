import { describe, expect, it } from "vitest";
import { lookupRecipe, hasQuantity, needsLookup, urlsMessage, pickUrls, isFetchableUrl, dishOf, provenance, LOOKUP_UA, type LookupInput } from "../import/lookup";
import type { Page } from "../import/extract";

describe("needsLookup", () => {
  it("a full recipe with five measured ingredients does not need a lookup", () => {
    expect(needsLookup("Pad kra pao\n1 lb ground chicken\n2 tbsp fish sauce\n1 tbsp oyster sauce\n4 cloves garlic\n1 cup holy basil\n1. Fry the garlic.\n2. Add chicken.")).toBe(false);
  });
  it("a title and two ingredients without amounts need a lookup", () => {
    expect(needsLookup("Honey garlic chicken thighs\nchicken thighs\nhoney\ngarlic")).toBe(true);
  });
  it("numbered steps with numbers in them do not count as measured ingredients", () => {
    expect(needsLookup("1. Bake 20 minutes at 400.\n2. Rest 5 minutes.\n3. Slice into 8 pieces.")).toBe(true);
  });
  it("a count at the start of the line counts even without a unit word", () => {
    expect(hasQuantity("2 eggs")).toBe(true);
    expect(hasQuantity("1 onion, diced")).toBe(true);
    expect(needsLookup("Omelette\n2 eggs\n1 onion\n1 tomato\nFry it all.")).toBe(false);
  });
  it("fractions with a unit count", () => {
    expect(hasQuantity("½ tsp salt")).toBe(true);
    expect(hasQuantity("a pinch of salt")).toBe(false);
    expect(hasQuantity("2 big handfuls spinach")).toBe(true);
  });
});

function ldPage(name: string, ingredients = 5, steps = 3, status = 200, finalUrl?: string): Page {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    recipeYield: "4 servings",
    recipeIngredient: Array.from({ length: ingredients }, (_, i) => `1 cup x${i + 1}`),
    recipeInstructions: Array.from({ length: steps }, (_, i) => ({ "@type": "HowToStep", text: `Step ${i + 1}.` })),
  };
  return {
    status,
    finalUrl: finalUrl ?? "https://a.example/r",
    contentType: "text/html; charset=utf-8",
    html: `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`,
    cfMitigated: false,
  };
}

const robots404 = (finalUrl: string): Page => ({ status: 404, finalUrl, html: "", cfMitigated: false });

type Routes = Record<string, Page>;

// Routes by URL: any robots.txt not listed answers 404; any page not listed answers 404 too.
function router(routes: Routes) {
  const calls: { url: string; timeoutMs: number; userAgent: string }[] = [];
  const getPage = async (url: string, timeoutMs: number, userAgent: string): Promise<Page> => {
    calls.push({ url, timeoutMs, userAgent });
    if (url in routes) return routes[url];
    return robots404(url);
  };
  return { getPage, calls };
}

const input: LookupInput = { platform: "tiktok", title: "Birria Tacos", text: "Birria tacos tonight, the full recipe is in my head" };

describe("lookupRecipe fast path", () => {
  it("1. a valid recipe page wins; only that page is credited and the slow path is not called", async () => {
    const r = router({
      "https://a.example/r": ldPage("Birria Tacos"),
      "https://b.example/r": ldPage("Birria Tacos", 5, 3, 200, "https://b.example/r"),
    });
    const slow = async () => null;
    const slowCalls: unknown[] = [];
    const out = await lookupRecipe(input, {
      findUrls: async () => ["https://a.example/r", "https://b.example/r"],
      getPage: r.getPage,
      slow: async (i, t) => {
        slowCalls.push([i, t]);
        return slow();
      },
    });
    expect(out.via).toBe("fast");
    expect(out.result!.text.startsWith("INGREDIENTS:")).toBe(true);
    expect(out.result!.basedOn).toEqual([{ url: "https://a.example/r", title: "Birria Tacos" }]);
    expect(out.result!.text.endsWith("makes 4 servings.")).toBe(true);
    expect(slowCalls).toHaveLength(0);
  });

  it("2. a robots.txt disallow on the first site skips it and the second wins", async () => {
    const r = router({
      "https://a.example/robots.txt": { status: 200, finalUrl: "https://a.example/robots.txt", html: "User-agent: *\nDisallow: /r", cfMitigated: false },
      "https://a.example/r": ldPage("Birria Tacos"),
      "https://b.example/r": ldPage("Birria Tacos", 5, 3, 200, "https://b.example/r"),
    });
    const out = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r", "https://b.example/r"], getPage: r.getPage });
    expect(out.result!.basedOn[0].url).toBe("https://b.example/r");
    expect(r.calls.some((c) => c.url === "https://a.example/r")).toBe(true);
  });

  it("3. a blocked page (403) is skipped and the second wins", async () => {
    const r = router({
      "https://a.example/r": ldPage("Birria Tacos", 5, 3, 403),
      "https://b.example/r": ldPage("Birria Tacos", 5, 3, 200, "https://b.example/r"),
    });
    const out = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r", "https://b.example/r"], getPage: r.getPage });
    expect(out.via).toBe("fast");
    expect(out.result!.basedOn[0].url).toBe("https://b.example/r");
  });

  it("4. a recipe for another dish is skipped", async () => {
    const r = router({
      "https://a.example/r": ldPage("Churros"),
      "https://b.example/r": ldPage("Birria Tacos", 5, 3, 200, "https://b.example/r"),
    });
    const out = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r", "https://b.example/r"], getPage: r.getPage });
    expect(out.result!.basedOn[0].url).toBe("https://b.example/r");
  });

  it("5. all pages fail: the slow path runs once with a bounded timeout and its result is used", async () => {
    const r = router({
      "https://a.example/r": ldPage("Birria Tacos", 5, 3, 403),
      "https://b.example/r": ldPage("Birria Tacos", 5, 3, 403),
    });
    const calls: number[] = [];
    const out = await lookupRecipe(input, {
      findUrls: async () => ["https://a.example/r", "https://b.example/r"],
      getPage: r.getPage,
      slow: async (_i, timeoutMs) => {
        calls.push(timeoutMs);
        return { text: "INGREDIENTS:\n- 1 cup x1", basedOn: [{ url: "https://slow.example/x" }] };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeLessThanOrEqual(45_000);
    expect(calls[0]).toBeGreaterThan(0);
    expect(out.via).toBe("slow");
  });

  it("6. slow returns null: no result, and the reason is the fast path's reason", async () => {
    const r = router({});
    const out = await lookupRecipe(input, {
      findUrls: async () => ["https://a.example/r"],
      getPage: r.getPage,
      slow: async () => null,
    });
    expect(out).toMatchObject({ result: null, via: null, reason: "no_page" });
  });

  it("7. unfetchable URLs are never fetched", async () => {
    const r = router({ "https://ok.example/a": ldPage("Birria Tacos", 5, 3, 200, "https://ok.example/a") });
    const out = await lookupRecipe(input, {
      slow: async () => null,
      findUrls: async () => ["ftp://x.example/a", "https://user:pw@x.example/a", "https://x.example:8080/a", "https://ok.example/a"],
      getPage: r.getPage,
    });
    expect(out.via).toBe("fast");
    const hosts = new Set(r.calls.map((c) => new URL(c.url).hostname));
    expect([...hosts]).toEqual(["ok.example"]);
  });

  it("8. the creator's own domain comes first", async () => {
    const r = router({
      "https://a.example/r": ldPage("Birria Tacos", 5, 3, 200, "https://a.example/r"),
      "https://bexample.com/r": ldPage("Birria Tacos", 5, 3, 200, "https://bexample.com/r"),
    });
    const out = await lookupRecipe({ ...input, author: "@bexample" }, {
      slow: async () => null,
      findUrls: async () => ["https://a.example/r", "https://bexample.com/r"],
      getPage: r.getPage,
    });
    expect(out.result!.basedOn[0].url).toBe("https://bexample.com/r");
  });

  it("9. past the deadline the slow path is skipped", async () => {
    let clock = 0;
    const slowCalls: number[] = [];
    const out = await lookupRecipe(input, {
      findUrls: async () => {
        clock = 53_000;
        return [];
      },
      now: () => clock,
      slow: async (_i, t) => {
        slowCalls.push(t);
        return null;
      },
    });
    expect(slowCalls).toHaveLength(0);
    expect(out.reason).toBe("deadline");
  });

  it("10. a throwing fast path is reported as fast_failed and the slow path still runs", async () => {
    const slowCalls: number[] = [];
    const out = await lookupRecipe(input, {
      findUrls: async () => {
        throw new Error("boom");
      },
      slow: async (_i, t) => {
        slowCalls.push(t);
        return null;
      },
    });
    expect(slowCalls).toHaveLength(1);
    expect(out).toMatchObject({ result: null, via: null, reason: "fast_failed" });
  });
});

const robotsPage = (url: string, status: number, html = ""): Page => ({ status, finalUrl: url, html, cfMitigated: false });

describe("robots and content type", () => {
  it("fails closed when robots.txt is 503 or 429, and skips that page", async () => {
    for (const status of [503, 429]) {
      const r = router({
        "https://a.example/robots.txt": robotsPage("https://a.example/robots.txt", status),
        "https://a.example/r": ldPage("Birria Tacos"),
        "https://b.example/r": ldPage("Birria Tacos", 5, 3, 200, "https://b.example/r"),
      });
      const out = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r", "https://b.example/r"], getPage: r.getPage });
      expect(out.result!.basedOn[0].url).toBe("https://b.example/r");
    }
  });

  it("content type is matched exactly: a type that only contains text/html is skipped, case and parameters are ignored", async () => {
    for (const [ct, accepted] of [["application/octet-stream; note=text/html", false], ["TEXT/HTML; charset=utf-8", true], ["application/xhtml+xml", true]] as const) {
      const r = router({ "https://a.example/r": { ...ldPage("Birria Tacos"), contentType: ct } });
      const out = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r"], getPage: r.getPage });
      expect(out.via === "fast").toBe(accepted);
    }
  });

  it("robots is checked on the final URL when only the path changed", async () => {
    const blocked = router({
      "https://a.example/public": ldPage("Birria Tacos", 5, 3, 200, "https://a.example/private/r"),
      "https://a.example/robots.txt": robotsPage("https://a.example/robots.txt", 200, "User-agent: *\nDisallow: /private"),
    });
    const skipped = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/public"], getPage: blocked.getPage });
    expect(skipped.result).toBeNull();

    const allowed = router({
      "https://a.example/public": ldPage("Birria Tacos", 5, 3, 200, "https://a.example/private/r"),
      "https://a.example/robots.txt": robotsPage("https://a.example/robots.txt", 200, "User-agent: *\nDisallow: /other"),
    });
    const accepted = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/public"], getPage: allowed.getPage });
    expect(accepted.result!.basedOn[0].url).toBe("https://a.example/private/r");
  });

  it("allows the page when robots.txt is 404", async () => {
    const r = router({ "https://a.example/r": ldPage("Birria Tacos") });
    const out = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r"], getPage: r.getPage });
    expect(out.result!.basedOn[0].url).toBe("https://a.example/r");
  });

  it("a cross-origin redirect is checked against the target origin's robots.txt", async () => {
    const page = (): Page => ldPage("Birria Tacos", 5, 3, 200, "https://b.example/private/r");
    const disallowed = router({
      "https://a.example/r": page(),
      "https://b.example/robots.txt": robotsPage("https://b.example/robots.txt", 200, "User-agent: *\nDisallow: /private"),
    });
    const skipped = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r"], getPage: disallowed.getPage });
    expect(skipped.result).toBeNull();
    expect(disallowed.calls.map((c) => c.url)).toContain("https://b.example/robots.txt");

    const allowed = router({
      "https://a.example/r": page(),
      "https://b.example/robots.txt": robotsPage("https://b.example/robots.txt", 200, "User-agent: *\nDisallow: /other"),
    });
    const accepted = await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r"], getPage: allowed.getPage });
    expect(accepted.result!.basedOn[0].url).toBe("https://b.example/private/r");
    expect(allowed.calls.map((c) => c.url)).toContain("https://b.example/robots.txt");
  });

  it("only HTML is read: a PDF is skipped, HTML is accepted, a missing content type is skipped", async () => {
    const pdf = router({ "https://a.example/r": { ...ldPage("Birria Tacos"), contentType: "application/pdf" } });
    expect((await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r"], getPage: pdf.getPage })).result).toBeNull();

    const html = router({ "https://a.example/r": { ...ldPage("Birria Tacos"), contentType: "text/html; charset=utf-8" } });
    expect((await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r"], getPage: html.getPage })).via).toBe("fast");

    const none = router({ "https://a.example/r": { ...ldPage("Birria Tacos"), contentType: undefined } });
    expect((await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r"], getPage: none.getPage })).result).toBeNull();
  });

  it("every getPage call carries LOOKUP_UA", async () => {
    const r = router({
      "https://a.example/r": ldPage("Birria Tacos"),
      "https://b.example/r": ldPage("Birria Tacos", 5, 3, 200, "https://b.example/r"),
    });
    await lookupRecipe(input, { slow: async () => null, findUrls: async () => ["https://a.example/r", "https://b.example/r"], getPage: r.getPage });
    expect(r.calls.length).toBeGreaterThan(0);
    for (const c of r.calls) expect(c.userAgent).toBe(LOOKUP_UA);
  });
});

describe("lookupRecipe deadlines", () => {
  it("a fast path that never settles is cut off and the slow path answers", async () => {
    const started = Date.now();
    const out = await lookupRecipe(input, {
      findUrls: () => new Promise<string[]>(() => {}),
      limits: { fastMs: 50 },
      slow: async () => ({ text: "INGREDIENTS:\n- 1 cup x1", basedOn: [{ url: "https://slow.example/x" }] }),
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.via).toBe("slow");
    expect(out.reason).toBeUndefined();
  });

  it("a fast path that never settles and a slow path with no result report fast_timeout", async () => {
    const out = await lookupRecipe(input, {
      findUrls: () => new Promise<string[]>(() => {}),
      limits: { fastMs: 50 },
      slow: async () => null,
    });
    expect(out).toMatchObject({ result: null, via: null, reason: "fast_timeout" });
  });

  it("a slow path that never settles is cut off with slow_timeout", async () => {
    const started = Date.now();
    const out = await lookupRecipe(input, {
      findUrls: async () => [],
      limits: { slowMs: 50 },
      slow: () => new Promise(() => {}),
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out).toMatchObject({ result: null, via: null, reason: "slow_timeout" });
  });

  it("a slow path that throws reports slow_failed", async () => {
    const out = await lookupRecipe(input, {
      findUrls: async () => [],
      slow: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toMatchObject({ result: null, via: null, reason: "slow_failed" });
  });
});

describe("provenance", () => {
  it("keeps only the pages the model cited in its text", () => {
    const content = [
      { type: "text", text: "x", citations: [{ url: "https://a.example/1", title: "A" }] },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://b.example/2" }] },
    ];
    expect(provenance(content)).toEqual([{ url: "https://a.example/1", title: "A" }]);
  });

  it("search results the model merely received are not sources", () => {
    const content = [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://b.example/2" }] }];
    expect(provenance(content)).toEqual([]);
  });
});

describe("lookup helpers", () => {
  it("11. the model message carries only the four post fields", () => {
    const extended = { ...input, allergies: ["peanut"], profile: { diet: "keto" }, familyNames: ["Ana"] } as LookupInput & { allergies: string[] };
    const json = urlsMessage(extended).slice("POST_JSON = ".length);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["author", "platform", "text", "title"]);
    expect(json).not.toContain("peanut");
    expect(json).not.toContain("keto");
    expect(json).not.toContain("Ana");
  });

  it("12. pickUrls keeps the named URLs that were really returned, and falls back to the results", () => {
    expect(pickUrls("see https://a.example/x, and https://z.example/y.", ["https://a.example/x", "https://b.example/"])).toEqual(["https://a.example/x"]);
    expect(pickUrls("no links here", ["https://a.example/x", "https://b.example/", "https://c.example/", "https://d.example/"])).toEqual([
      "https://a.example/x",
      "https://b.example/",
      "https://c.example/",
    ]);
    const cases = ["ftp://x.example/a", "https://user:pw@x.example/a", "https://x.example:8080/a", "https://ok.example/a"];
    expect(cases.map(isFetchableUrl)).toEqual([false, false, false, true]);
  });

  it("13. dishOf reads the Title line when there is no title, and the title when set", () => {
    expect(dishOf({ platform: "tiktok", text: "Title: Marry Me Chicken\nCaption: yum" })).toBe("Marry Me Chicken");
    expect(dishOf({ platform: "tiktok", title: "Birria Tacos", text: "Title: Other" })).toBe("Birria Tacos");
  });
});
