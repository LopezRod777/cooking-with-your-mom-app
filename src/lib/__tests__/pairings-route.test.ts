import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { getSql } from "../db";
import { requireUser } from "../auth/requireUser";
import { anthropic } from "../ai/client";
import { COOKIE, signUnlock } from "../pairings/cookie";
import {
  claimInflight,
  getPairing,
  getUnlock,
  releaseInflight,
  renewInflight,
  reserveQuota,
  savePairing,
} from "../pairings/db";
import { VOCAB } from "../pairings/vocab";
import { makeRecipe } from "./fixtures";
import { GET, POST } from "../../app/api/pair/route";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn() }));
vi.mock("../db", () => ({ getSql: vi.fn() }));
vi.mock("../ai/client", () => ({ MODEL: "test-model", anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../pairings/db", () => ({
  claimInflight: vi.fn(),
  createUnlock: vi.fn(),
  deleteUnlock: vi.fn(),
  getPairing: vi.fn(),
  getUnlock: vi.fn(),
  releaseInflight: vi.fn(),
  renewInflight: vi.fn(),
  reserveQuota: vi.fn(),
  savePairing: vi.fn(),
}));

const USER = "user_test_1";
const SESSION = "sess_test_1";
const NONCE = "a".repeat(64);
const RECIPE_ID = "tacos-al-pastor";

const recipe = makeRecipe({ id: RECIPE_ID, title: "Tacos al pastor", cuisine: "Mexican", slot: "dinner" });

// A valid model answer built from the real vocabulary.
const w1 = VOCAB.wines[0];
const w2 = VOCAB.wines[1];
const principle = VOCAB.principles[0].id;
const validOutput = {
  wines: [
    {
      styleId: w1.id,
      grapeIds: [w1.grapes[0]],
      regionIds: [w1.regions[0]],
      whyPrincipleIds: [principle],
      tier: "everyday",
      serveTempF: w1.serveTempF[0],
    },
    {
      styleId: w2.id,
      grapeIds: [w2.grapes[0]],
      regionIds: [w2.regions[0]],
      whyPrincipleIds: [principle],
      tier: "step-up",
      serveTempF: w2.serveTempF[0],
    },
  ],
  other: [{ styleId: "pilsner", whyPrincipleIds: [principle] }],
  zeroProof: [{ styleId: "sparkling-water-citrus" }],
  avoid: [{ styleId: VOCAB.wines[2].id, avoidReasonId: "tannic-with-light" }],
  confidence: 0.8,
};

function modelText(obj: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

function setSession(userId: string | null, sessionId: string | null) {
  vi.mocked(auth).mockResolvedValue({ userId, sessionId } as unknown as Awaited<ReturnType<typeof auth>>);
}

function setCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === COOKIE && value !== undefined ? { name, value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

// Unlocked session: the cookie is valid for this user, session and nonce.
function unlocked() {
  setSession(USER, SESSION);
  setCookie(signUnlock(USER, SESSION, NONCE));
  vi.mocked(getUnlock).mockResolvedValue({ session_id: SESSION, nonce: NONCE });
}

function locked() {
  setSession(USER, SESSION);
  setCookie(undefined);
  vi.mocked(getUnlock).mockResolvedValue(null);
}

function withState(state: unknown) {
  vi.mocked(getSql).mockReturnValue({
    query: vi.fn(async () => [{ state }]),
  } as unknown as ReturnType<typeof getSql>);
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function create() {
  return vi.mocked(anthropic.messages.create);
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.PAIRINGS_COOKIE_SECRET = "test-secret-pairings-route";
  vi.mocked(requireUser).mockResolvedValue({ userId: USER, email: "diego@example.com" });
  withState({ plan: null, favoriteRecipes: { [RECIPE_ID]: recipe } });
  vi.mocked(claimInflight).mockResolvedValue(true);
  vi.mocked(reserveQuota).mockResolvedValue(1);
  vi.mocked(renewInflight).mockResolvedValue(true);
  vi.mocked(releaseInflight).mockResolvedValue(undefined);
  vi.mocked(savePairing).mockResolvedValue("saved");
  unlocked();
  create().mockResolvedValue(modelText(validOutput) as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/pair", () => {
  it("403 locked without the gate, and never calls the model or the lease", async () => {
    locked();
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "locked" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(claimInflight).not.toHaveBeenCalled();
    expect(create()).not.toHaveBeenCalled();
  });

  it("404 unknown_recipe when the id is not in the plan or favorites", async () => {
    withState({ plan: null, favoriteRecipes: {} });
    const res = await POST(postReq({ recipeId: "nope" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_recipe" });
    expect(create()).not.toHaveBeenCalled();
  });

  it("finds the recipe in this week's plan too", async () => {
    withState({ plan: { recipes: { [RECIPE_ID]: recipe } }, favoriteRecipes: {} });
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(200);
  });

  it("429 quota when the daily reservation is exhausted, and no model call", async () => {
    vi.mocked(reserveQuota).mockResolvedValue(null);
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "quota" });
    expect(create()).not.toHaveBeenCalled();
    expect(releaseInflight).toHaveBeenCalledOnce();
  });

  it("409 busy when another generation holds the user's lease", async () => {
    vi.mocked(claimInflight).mockResolvedValue(false);
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "busy" });
    expect(releaseInflight).not.toHaveBeenCalled();
  });

  it("invalid output twice gives 422, retries once with a second reservation, and saves nothing", async () => {
    create().mockResolvedValue(modelText({ wines: [] }) as never);
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_confident_pairing" });
    expect(create()).toHaveBeenCalledTimes(2);
    expect(reserveQuota).toHaveBeenCalledTimes(2);
    expect(savePairing).not.toHaveBeenCalled();
    expect(releaseInflight).toHaveBeenCalledOnce();
  });

  it("invalid once then valid succeeds on the retry", async () => {
    create()
      .mockResolvedValueOnce(modelText({ wines: [] }) as never)
      .mockResolvedValueOnce(modelText(validOutput) as never);
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(200);
    expect(create()).toHaveBeenCalledTimes(2);
    expect(savePairing).toHaveBeenCalledOnce();
  });

  it("lowConfidence gives 422 without a retry and nothing saved", async () => {
    create().mockResolvedValue(modelText({ ...validOutput, confidence: 0.1 }) as never);
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_confident_pairing" });
    expect(create()).toHaveBeenCalledOnce();
    expect(savePairing).not.toHaveBeenCalled();
  });

  it("gate closed during generation gives 403 and nothing is saved", async () => {
    // First check (before the model) passes; the re-check after the model finds no unlock row.
    vi.mocked(getUnlock)
      .mockResolvedValueOnce({ session_id: SESSION, nonce: NONCE })
      .mockResolvedValueOnce(null);
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "locked" });
    expect(create()).toHaveBeenCalledOnce();
    expect(savePairing).not.toHaveBeenCalled();
  });

  it("lease_lost on save gives 409", async () => {
    vi.mocked(savePairing).mockResolvedValue("lease_lost");
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "lease_lost" });
  });

  it("a lease lost during the model call gives 409 and nothing is saved", async () => {
    vi.useFakeTimers();
    vi.mocked(renewInflight).mockResolvedValue(false);
    create().mockImplementation(((_body: unknown, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })) as never);
    const pending = POST(postReq({ recipeId: RECIPE_ID }));
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "lease_lost" });
    expect(savePairing).not.toHaveBeenCalled();
  });

  it("success saves the pairing under the recipe id and returns it", async () => {
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recipeId: string; pairing: { wines: unknown[] }; createdAt: string };
    expect(body.recipeId).toBe(RECIPE_ID);
    expect(body.pairing.wines).toHaveLength(2);
    expect(typeof body.createdAt).toBe("string");
    const [userId, recipeId, json, owner] = vi.mocked(savePairing).mock.calls[0];
    expect(userId).toBe(USER);
    expect(recipeId).toBe(RECIPE_ID);
    expect(json).toMatchObject({ pairing: { confidence: 0.8 } });
    expect(typeof owner).toBe("string");
    expect(releaseInflight).toHaveBeenCalledWith(USER, owner);
  });

  it("sends only the reduced recipe to the model, framed as data", async () => {
    await POST(postReq({ recipeId: RECIPE_ID }));
    const [params] = create().mock.calls[0] as unknown as [{ system: string; messages: { content: string }[] }];
    expect(params.messages[0].content).toContain("Tacos al pastor");
    expect(params.messages[0].content).toContain("<RECIPE_JSON>");
    expect(params.messages[0].content).not.toContain('"steps"');
  });

  it("each model call passes maxRetries 0, so one reservation covers one network attempt", async () => {
    await POST(postReq({ recipeId: RECIPE_ID }));
    const [, opts] = create().mock.calls[0] as unknown as [unknown, { maxRetries?: number; signal?: AbortSignal }];
    expect(opts.maxRetries).toBe(0);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("a provider failure gives 502 with Cache-Control private, no-store", async () => {
    create().mockRejectedValue(new Error("upstream down"));
    const res = await POST(postReq({ recipeId: RECIPE_ID }));
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(savePairing).not.toHaveBeenCalled();
    expect(releaseInflight).toHaveBeenCalledOnce();
  });
});

describe("GET /api/pair", () => {
  it("403 locked without the gate", async () => {
    locked();
    const res = await GET(new Request(`http://localhost/api/pair?recipeId=${RECIPE_ID}`));
    expect(res.status).toBe(403);
    expect(getPairing).not.toHaveBeenCalled();
  });

  it("404 when nothing is saved for the recipe", async () => {
    vi.mocked(getPairing).mockResolvedValue(null);
    const res = await GET(new Request(`http://localhost/api/pair?recipeId=${RECIPE_ID}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404 when the recipe is gone from the plan and favorites, even if a pairing is saved", async () => {
    withState({ plan: null, favoriteRecipes: {} });
    vi.mocked(getPairing).mockResolvedValue({ pairing: validOutput, createdAt: "2026-10-31T00:00:00.000Z" });
    const res = await GET(new Request(`http://localhost/api/pair?recipeId=${RECIPE_ID}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_recipe" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getPairing).not.toHaveBeenCalled();
  });

  it("200 with the saved pairing", async () => {
    vi.mocked(getPairing).mockResolvedValue({ pairing: validOutput, createdAt: "2026-10-31T00:00:00.000Z" });
    const res = await GET(new Request(`http://localhost/api/pair?recipeId=${RECIPE_ID}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      recipeId: RECIPE_ID,
      pairing: validOutput,
      createdAt: "2026-10-31T00:00:00.000Z",
    });
  });
});
