import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reserveAiQuota } from "../ai/dailyQuota";
import { requireUser } from "../auth/requireUser";
import { extractSource } from "../import/extract";
import { lookupRecipe, needsLookup } from "../import/lookup";
import { remoteExtract, type RemoteExtract } from "../import/remote";
import { structureRecipe } from "../import/structure";
import { maxDuration, POST } from "../../app/api/import/route";

vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn(), isAdminEmail: vi.fn(() => false) }));
vi.mock("../ai/dailyQuota", () => ({ reserveAiQuota: vi.fn(async () => true), quotaExceededResponse: vi.fn() }));
vi.mock("../import/remote", async (orig) => ({ ...(await orig<typeof import("../import/remote")>()), remoteExtract: vi.fn() }));
vi.mock("../import/extract", async (orig) => ({ ...(await orig<typeof import("../import/extract")>()), extractSource: vi.fn() }));
vi.mock("../import/lookup", async (orig) => ({ ...(await orig<typeof import("../import/lookup")>()), lookupRecipe: vi.fn(), needsLookup: vi.fn() }));
vi.mock("../import/structure", () => ({ structureRecipe: vi.fn() }));

const LINK = "https://www.tiktok.com/@a/video/7299171137416744225";
const PROFILE = { version: 1, onboarded: true };
const ask = (signal?: AbortSignal) =>
  POST(new Request("https://app.test/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: LINK, profile: PROFILE }), signal }));
const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const TEXT = "Two chicken breasts, one cup of rice, sear four minutes a side and serve.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireUser).mockResolvedValue({ userId: "user_A", email: "a@example.com" });
  vi.mocked(needsLookup).mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle(p: Promise<Response>) {
  const started = Date.now();
  let at = 0;
  void p.then(() => (at = Date.now() - started));
  await vi.advanceTimersByTimeAsync(400_000);
  return { res: await p, at };
}

describe("POST /api/import, time", () => {
  it("answers before the platform cuts it when every step is at its slowest", async () => {
    vi.mocked(remoteExtract).mockImplementation(() => later<RemoteExtract>(155_000, { ok: false, reason: "timeout" }));
    vi.mocked(extractSource).mockImplementation(() => later(24_000, { platform: "tiktok" as const, url: LINK, ok: true, text: TEXT }));
    vi.mocked(lookupRecipe).mockImplementation(() => later(56_000, { result: null, via: null, fastMs: 0, slowMs: 0 }));
    vi.mocked(structureRecipe).mockImplementation((_i, signal) => new Promise((_, no) => signal!.addEventListener("abort", () => no(signal!.reason))));
    const { res, at } = await settle(ask());
    expect(res.status).toBe(502);
    expect(at).toBeLessThan(maxDuration * 1000 - 10_000);
  });

  it("counts slow sign-in inside the same limit", async () => {
    vi.mocked(requireUser).mockImplementation(() => later(20_000, { userId: "user_A", email: "a@example.com" }));
    vi.mocked(remoteExtract).mockImplementation(() => later<RemoteExtract>(155_000, { ok: false, reason: "timeout" }));
    vi.mocked(extractSource).mockResolvedValue({ platform: "tiktok", url: LINK, ok: true, text: TEXT });
    vi.mocked(needsLookup).mockReturnValue(false);
    vi.mocked(structureRecipe).mockImplementation(() => new Promise(() => {}));
    const { res, at } = await settle(ask());
    expect(res.status).toBe(502);
    expect(at).toBe(285_000);
  });

  it("answers even when the quota never does, and starts nothing paid afterwards", async () => {
    vi.mocked(reserveAiQuota).mockImplementationOnce(() => later(350_000, true));
    const { res, at } = await settle(ask());
    expect(res.status).toBe(502);
    expect(at).toBe(285_000);
    expect(remoteExtract).not.toHaveBeenCalled();
    expect(structureRecipe).not.toHaveBeenCalled();
  });

  it("someone who leaves while the page is read starts no lookup and no model", async () => {
    const ctl = new AbortController();
    vi.mocked(remoteExtract).mockResolvedValue({ ok: false, reason: "timeout" });
    vi.mocked(extractSource).mockImplementation(async () => {
      ctl.abort();
      return later(1_000, { platform: "tiktok" as const, url: LINK, ok: true, text: TEXT });
    });
    const { res } = await settle(ask(ctl.signal));
    expect(res.status).toBe(499);
    expect(lookupRecipe).not.toHaveBeenCalled();
    expect(structureRecipe).not.toHaveBeenCalled();
  });

  it("gives up on a page that never answers", async () => {
    vi.mocked(remoteExtract).mockResolvedValue({ ok: false, reason: "timeout" });
    vi.mocked(extractSource).mockImplementation(() => new Promise(() => {}));
    const { res, at } = await settle(ask());
    expect(await res.json()).toMatchObject({ needsText: true, reason: "timeout" });
    expect(at).toBe(25_000);
  });

  it("skips the lookup when there is no time left for it", async () => {
    vi.mocked(remoteExtract).mockImplementation(() => later<RemoteExtract>(190_000, { ok: false, reason: "timeout" }));
    vi.mocked(extractSource).mockResolvedValue({ platform: "tiktok", url: LINK, ok: true, text: TEXT });
    vi.mocked(structureRecipe).mockResolvedValue({ id: "r" } as never);
    const { res } = await settle(ask());
    expect(await res.json()).toEqual({ recipe: { id: "r" } });
    expect(lookupRecipe).not.toHaveBeenCalled();
  });
});

describe("POST /api/import, line full and people who leave", () => {
  it("says busy when the video line is full and the page has no recipe", async () => {
    vi.mocked(remoteExtract).mockResolvedValue({ ok: false, reason: "busy" });
    vi.mocked(extractSource).mockResolvedValue({ platform: "tiktok", url: LINK, ok: false, reason: "no_text" });
    const { res } = await settle(ask());
    expect(await res.json()).toMatchObject({ needsText: true, reason: "busy" });
  });

  it("uses the page when it does have the recipe", async () => {
    vi.mocked(needsLookup).mockReturnValue(false);
    vi.mocked(remoteExtract).mockResolvedValue({ ok: false, reason: "busy" });
    vi.mocked(extractSource).mockResolvedValue({ platform: "tiktok", url: LINK, ok: true, text: TEXT });
    vi.mocked(structureRecipe).mockResolvedValue({ id: "r" } as never);
    const { res } = await settle(ask());
    expect(await res.json()).toEqual({ recipe: { id: "r" } });
  });

  it("stops after the video step when the person left: no page, no model", async () => {
    const ctl = new AbortController();
    vi.mocked(remoteExtract).mockImplementation(async (_u, deps) => {
      ctl.abort();
      expect(deps?.signal?.aborted).toBe(true);
      return { ok: false, reason: "timeout" };
    });
    const { res } = await settle(ask(ctl.signal));
    expect(res.status).toBe(499);
    expect(extractSource).not.toHaveBeenCalled();
    expect(structureRecipe).not.toHaveBeenCalled();
  });
});
