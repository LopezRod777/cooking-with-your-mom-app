import { describe, expect, it, vi } from "vitest";
import { buildSource } from "../import/structure";
import { hasNoRecipe, remoteExtract, textFromRemote, type RemoteOk } from "../import/remote";

const URL_IN = "https://www.tiktok.com/@jalalsamfit/video/7299171137416744225";
const ENV = { EXTRACT_URL: "https://extract.example.test/", EXTRACT_SECRET: "test-secret" };

// Fixture shaped like the live service response (services/extract/server.mjs).
const OK_BODY = {
  ok: true,
  platform: "tiktok",
  id: "7299171137416744225",
  url: URL_IN,
  author: "Jalal",
  authorHandle: "jalalsamfit",
  caption: "Chicken rice bowl in 15 min #mealprep",
  likes: 1300000.4,
  views: 20500000,
  comments: 900,
  durationS: 16,
  videoUrl: "https://blob.example.test/sources/tiktok/7299171137416744225.mp4",
  thumbUrl: "https://blob.example.test/sources/tiktok/7299171137416744225.jpg",
  transcript: "Two chicken breasts, a cup of rice, then sear it four minutes a side.",
  onScreenText: ["2 chicken breasts", "1 cup rice"],
  ingredients: ["2 chicken breasts", "1 cup rice", "1 can black beans"],
  steps: ["Cook the rice.", "Sear the chicken four minutes per side."],
  dish: "Chicken rice bowl",
  notes: "Swap rice for cauliflower rice if you want fewer carbs.",
  timings: { ytdlpMs: 4000, uploadMs: 800, geminiMs: 12000 },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return r.clone();
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls, fetchMock };
}

const okRemote = (over: Partial<RemoteOk> = {}): RemoteOk => ({
  ok: true,
  platform: "tiktok",
  url: URL_IN,
  onScreenText: [],
  ingredients: [],
  steps: [],
  ...over,
});

describe("remoteExtract", () => {
  it("returns null when EXTRACT_URL or EXTRACT_SECRET is missing", async () => {
    const f = fakeFetch(json(200, OK_BODY));
    expect(await remoteExtract(URL_IN, { env: { EXTRACT_SECRET: "x" }, fetch: f.fetch })).toBeNull();
    expect(await remoteExtract(URL_IN, { env: { EXTRACT_URL: "https://x.test" }, fetch: f.fetch })).toBeNull();
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("posts to /extract with the bearer secret and parses the fixture", async () => {
    const f = fakeFetch(json(200, OK_BODY));
    const r = await remoteExtract(URL_IN, { env: ENV, fetch: f.fetch });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("https://extract.example.test/extract");
    expect(f.calls[0].init.method).toBe("POST");
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-secret");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ url: URL_IN });
    expect(r).toMatchObject({
      ok: true,
      platform: "tiktok",
      authorHandle: "jalalsamfit",
      likes: 1300000,
      views: 20500000,
      durationS: 16,
      videoUrl: OK_BODY.videoUrl,
      thumbUrl: OK_BODY.thumbUrl,
      dish: "Chicken rice bowl",
    });
    expect((r as RemoteOk).ingredients).toHaveLength(3);
    expect((r as RemoteOk).steps).toHaveLength(2);
  });

  it("drops URLs that are not http(s) and negative counts", async () => {
    const f = fakeFetch(json(200, { ...OK_BODY, videoUrl: "javascript:alert(1)", thumbUrl: "not a url", likes: -4 }));
    const r = (await remoteExtract(URL_IN, { env: ENV, fetch: f.fetch })) as RemoteOk;
    expect(r.videoUrl).toBeUndefined();
    expect(r.thumbUrl).toBeUndefined();
    expect(r.likes).toBeUndefined();
  });

  it("retries once after 8 s when the service is busy, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const f = fakeFetch(json(429, { ok: false, reason: "busy" }), json(200, OK_BODY));
    const r = await remoteExtract(URL_IN, { env: ENV, fetch: f.fetch, sleep });
    expect(sleep).toHaveBeenCalledWith(8000);
    expect(f.calls).toHaveLength(2);
    expect(r).toMatchObject({ ok: true });
  });

  it("gives up with busy when the retry is busy too", async () => {
    const sleep = vi.fn(async () => {});
    const f = fakeFetch(json(429, { ok: false, reason: "busy" }));
    const r = await remoteExtract(URL_IN, { env: ENV, fetch: f.fetch, sleep });
    expect(f.calls).toHaveLength(2);
    expect(r).toEqual({ ok: false, reason: "busy" });
  });

  it("returns the service reason for a failure body, without retrying", async () => {
    const sleep = vi.fn(async () => {});
    const f = fakeFetch(json(502, { ok: false, reason: "ytdlp_failed" }));
    const r = await remoteExtract(URL_IN, { env: ENV, fetch: f.fetch, sleep });
    expect(r).toEqual({ ok: false, reason: "ytdlp_failed" });
    expect(sleep).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(1);
  });

  it("maps a network error to fetch_failed and a timeout to timeout", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await remoteExtract(URL_IN, { env: ENV, fetch: down as unknown as typeof fetch })).toEqual({
      ok: false,
      reason: "fetch_failed",
    });
    const late = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    expect(await remoteExtract(URL_IN, { env: ENV, fetch: late as unknown as typeof fetch })).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("rejects a 200 body that does not look like the service", async () => {
    const f = fakeFetch(json(200, { hello: "world" }));
    expect(await remoteExtract(URL_IN, { env: ENV, fetch: f.fetch })).toEqual({ ok: false, reason: "bad_response" });
  });

  it("reports http_<status> when a failure has no reason", async () => {
    const f = fakeFetch(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await remoteExtract(URL_IN, { env: ENV, fetch: f.fetch })).toEqual({ ok: false, reason: "http_502" });
  });
});

describe("textFromRemote", () => {
  it("builds the full layout with every section", () => {
    const r = okRemote({
      dish: "Chicken rice bowl",
      caption: "Quick bowl",
      transcript: "Sear the chicken.",
      onScreenText: ["2 chicken breasts"],
      ingredients: ["2 chicken breasts", "1 cup rice"],
      steps: ["Cook the rice.", "Sear the chicken."],
      notes: "Swap rice for cauliflower.",
    });
    expect(textFromRemote(r)).toBe(
      [
        "Title: Chicken rice bowl\nCaption: Quick bowl",
        "Spoken: Sear the chicken.",
        "On screen:\n- 2 chicken breasts",
        "Ingredients:\n- 2 chicken breasts\n- 1 cup rice",
        "Steps:\n1. Cook the rice.\n2. Sear the chicken.",
        "Notes: Swap rice for cauliflower.",
      ].join("\n\n"),
    );
  });

  it("omits empty sections", () => {
    const r = okRemote({ caption: "Only a caption", steps: ["Mix it."] });
    expect(textFromRemote(r)).toBe("Caption: Only a caption\n\nSteps:\n1. Mix it.");
  });

  it("returns an empty string when nothing is there", () => {
    expect(textFromRemote(okRemote())).toBe("");
  });
});

describe("hasNoRecipe", () => {
  it("is true only when lists are empty and speech and caption are short", () => {
    expect(hasNoRecipe(okRemote({ transcript: "Morning vibes.", caption: "#gym" }))).toBe(true);
  });
  it("is false when there are ingredients or steps", () => {
    expect(hasNoRecipe(okRemote({ ingredients: ["1 egg"] }))).toBe(false);
    expect(hasNoRecipe(okRemote({ steps: ["Crack it."] }))).toBe(false);
  });
  it("is false when the transcript or the caption is 40 characters or more", () => {
    expect(hasNoRecipe(okRemote({ transcript: "x".repeat(40) }))).toBe(false);
    expect(hasNoRecipe(okRemote({ caption: "y".repeat(40) }))).toBe(false);
  });
});

describe("buildSource with video credit", () => {
  it("keeps the video fields and drops invalid ones", () => {
    const src = buildSource({
      platform: "tiktok",
      url: URL_IN,
      title: "Chicken rice bowl",
      author: "@jalalsamfit",
      image: "https://blob.example.test/sources/tiktok/x.jpg",
      videoUrl: "https://blob.example.test/sources/tiktok/x.mp4",
      likes: 1300000.4,
      views: 20500000,
      durationS: 16,
    });
    expect(src).toMatchObject({
      url: URL_IN,
      platform: "tiktok",
      videoUrl: "https://blob.example.test/sources/tiktok/x.mp4",
      likes: 1300000,
      views: 20500000,
      durationS: 16,
    });
    const bad = buildSource({ platform: "tiktok", url: URL_IN, videoUrl: "ftp://x", likes: -1, durationS: -2 });
    expect(bad.videoUrl).toBeUndefined();
    expect(bad.likes).toBeUndefined();
    expect(bad.durationS).toBeUndefined();
  });
});
