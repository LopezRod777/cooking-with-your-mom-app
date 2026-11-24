import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DNS is mocked so tests never touch the network. The table decides what each hostname resolves to.
const dnsTable: Record<string, string[]> = {};
// The real connection goes through undici's fetch with a guarded dispatcher; here it delegates to the stubbed global.
vi.mock("undici", () => ({
  Agent: class {},
  fetch: (...args: unknown[]) => (globalThis.fetch as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("node:dns", () => ({
  lookup: (host: string, _o: unknown, cb: (e: Error | null, a: { address: string; family: number }[]) => void) =>
    cb(null, host === "rebind.example.com" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const addrs = dnsTable[host];
    if (!addrs) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  },
}));

import { BlockedHostError, extractSource, fetchPage, guardedLookup, isPrivateAddress, isPublicHost, normalizeUrl } from "../import/extract";

const RECIPE_HTML = `<html><head><script type="application/ld+json">
{"@type":"Recipe","name":"Soup","recipeIngredient":["2 cups water"],"recipeInstructions":["Boil it."]}
</script></head><body></body></html>`;

function response(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/html", ...headers } });
}

beforeEach(() => {
  for (const k of Object.keys(dnsTable)) delete dnsTable[k];
  dnsTable["recipes.example.com"] = ["93.184.216.34"];
  dnsTable["cdn.example.com"] = ["93.184.216.35"];
  dnsTable["evil.test"] = ["127.0.0.1"];
  dnsTable["mixed.test"] = ["93.184.216.34", "10.0.0.7"];
  dnsTable["rebind.test"] = ["192.168.1.20"];
  dnsTable["public.example"] = ["93.184.216.34"];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPrivateAddress (IPv4)", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "127.0.0.1",
    "127.255.0.9",
    "100.64.0.1",
    "100.127.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "1.1.1.1"])(
    "allows %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );

  it("refuses unparseable IPv4 text", () => {
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
    expect(isPrivateAddress("1.2.3")).toBe(true);
  });
});

describe("isPrivateAddress (IPv6)", () => {
  it.each([
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::ffff",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.5",
    "::ffff:192.168.0.9",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:93.184.216.34", "::ffff:5db8:d822"])(
    "allows %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe("isPublicHost", () => {
  it("rejects names that are internal by spelling, without a lookup", async () => {
    for (const h of ["localhost", "api.localhost", "printer.local", "db.internal", "[::1]"]) {
      expect(await isPublicHost(h)).toBe(false);
    }
  });

  it("requires every resolved address to be public", async () => {
    expect(await isPublicHost("recipes.example.com")).toBe(true);
    expect(await isPublicHost("mixed.test")).toBe(false);
    expect(await isPublicHost("evil.test")).toBe(false);
  });

  it("fails closed when the name does not resolve", async () => {
    expect(await isPublicHost("nowhere.invalid")).toBe(false);
  });
});

describe("normalizeUrl", () => {
  it("allows only http and https", () => {
    expect(normalizeUrl("https://recipes.example.com/a")).toBe("https://recipes.example.com/a");
    expect(normalizeUrl("http://recipes.example.com/a")).toBe("http://recipes.example.com/a");
    expect(normalizeUrl("recipes.example.com/a")).toBe("https://recipes.example.com/a");
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/x", "gopher://example.com/", "data:text/html,hi"]) {
      expect(normalizeUrl(bad)).toBeNull();
    }
  });
});

describe("extractSource SSRF guard", () => {
  it("never contacts a redirect target that lands on 127.0.0.1", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://recipes.example.com/post") {
        return response(302, "", { location: "http://127.0.0.1:8080/admin" });
      }
      throw new Error("must not fetch " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await extractSource("https://recipes.example.com/post");
    expect(res).toMatchObject({ ok: false, reason: "blocked_host" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a name that resolves to a private address", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://recipes.example.com/post") return response(301, "", { location: "https://rebind.test/x" });
      throw new Error("must not fetch " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await extractSource("https://recipes.example.com/post")).toMatchObject({ ok: false, reason: "blocked_host" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a non-http scheme", async () => {
    const fetchMock = vi.fn(async () => response(302, "", { location: "file:///etc/passwd" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await extractSource("https://recipes.example.com/post")).toMatchObject({ ok: false, reason: "blocked_host" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a public redirect chain and reads the recipe", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://recipes.example.com/post") return response(301, "", { location: "/recipe/soup" });
      if (url === "https://recipes.example.com/recipe/soup") return response(302, "", { location: "https://cdn.example.com/soup" });
      if (url === "https://cdn.example.com/soup") return response(200, RECIPE_HTML);
      throw new Error("unexpected " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await extractSource("https://recipes.example.com/post");
    expect(res).toMatchObject({ ok: true, title: "Soup", url: "https://cdn.example.com/soup" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect((call as unknown as [string, RequestInit])[1]).toMatchObject({ redirect: "manual" });
    }
  });

  it("stops after 4 redirects", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => response(302, "", { location: `https://recipes.example.com/hop${++n}` }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await extractSource("https://recipes.example.com/start")).toMatchObject({
      ok: false,
      reason: "too_many_redirects",
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("stops reading an endless body at 2 MB", async () => {
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200, headers: { "content-type": "text/html" } })));
    const res = await extractSource("https://recipes.example.com/endless");
    expect(res.ok).toBe(false);
    // The stream's own read-ahead queues a few chunks beyond what the reader consumed, so allow 4 chunks of slack.
    expect(pulls * chunk.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024 + 4 * chunk.byteLength);
  });
});

describe("fetchPage hop guard and headers", () => {
  const UA = "CookingWithYourMom/1.0 (+https://cookingwithyourmom.zouthrock.com)";

  it.each([
    ["a non-standard port", "https://public.example:8080/admin"],
    ["embedded credentials", "https://user:pw@public.example/b"],
  ])("refuses a redirect to %s without contacting it", async (_label, location) => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPage("https://public.example/a")).rejects.toBeInstanceOf(BlockedHostError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns contentType, finalUrl and status for a plain 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(200, "<html></html>", { "content-type": "text/html; charset=utf-8" })),
    );
    const page = await fetchPage("https://public.example/a", 1000);
    expect(page.contentType?.startsWith("text/html")).toBe(true);
    expect(page.finalUrl).toBe("https://public.example/a");
    expect(page.status).toBe(200);
  });

  it("sends the UA it was given as the User-Agent header", async () => {
    const fetchMock = vi.fn(async () => response(200, "<html></html>"));
    vi.stubGlobal("fetch", fetchMock);
    await fetchPage("https://public.example/a", 1000, UA);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ "User-Agent": UA });
  });
});

describe("guardedLookup (connection-time DNS check against rebinding)", () => {
  const run = (host: string, all: boolean) =>
    new Promise<{ err: (Error & { code?: string }) | null; address: unknown }>((resolve) =>
      guardedLookup(host, { all }, (err, address) => resolve({ err, address })),
    );

  it("refuses a name whose answer at connect time is private", async () => {
    const { err } = await run("rebind.example.com", false);
    expect(err).toBeInstanceOf(BlockedHostError);
    expect(err?.code).toBe("EBLOCKED");
  });

  it("passes a public answer through, single and all", async () => {
    expect((await run("recipes.example.com", false)).address).toBe("93.184.216.34");
    expect((await run("recipes.example.com", true)).address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});
