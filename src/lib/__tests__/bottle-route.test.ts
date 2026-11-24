import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { getSql } from "../db";
import { requireUser } from "../auth/requireUser";
import { anthropic } from "../ai/client";
import { COOKIE, signUnlock } from "../pairings/cookie";
import { claimInflight, getUnlock, releaseInflight, renewInflight, reserveBottleQuota } from "../pairings/db";
import { planFingerprint, serveLineFor, servedRecipeIds } from "../pairings/bottle";
import { VOCAB } from "../pairings/vocab";
import { makePlan, makeRecipe } from "./fixtures";
import { POST } from "../../app/api/pair/bottle/route";

const sharpMock = vi.hoisted(() => {
  const toBuffer = vi.fn();
  const chain = { rotate: vi.fn(), resize: vi.fn(), jpeg: vi.fn(), toBuffer };
  return { chain, toBuffer, factory: vi.fn() };
});

vi.mock("sharp", () => ({ default: sharpMock.factory }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn() }));
vi.mock("../db", () => ({ getSql: vi.fn() }));
vi.mock("../ai/dailyQuota", () => ({ reserveSharedQuota: vi.fn(async () => true) }));
vi.mock("../ai/client", () => ({ MODEL: "test-model", anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../pairings/db", () => ({
  claimInflight: vi.fn(),
  getUnlock: vi.fn(),
  releaseInflight: vi.fn(),
  renewInflight: vi.fn(),
  reserveBottleQuota: vi.fn(),
}));

const USER = "user_test_bottle";
const SESSION = "sess_test_bottle";
const NONCE = "b".repeat(64);
const URL_BOTTLE = "http://localhost/api/pair/bottle";

// A JPEG-looking header; sharp is mocked, so only the magic bytes matter here.
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64");
const REENCODED = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const recipeA = makeRecipe({ id: "tacos-al-pastor", title: "Tacos al pastor", cuisine: "Mexican", slot: "dinner" });
const recipeB = makeRecipe({ id: "ramen-miso", title: "Miso ramen", cuisine: "Japanese", slot: "dinner" });
const plan = makePlan([{ recipe: recipeA }, { recipe: recipeB }]);
const planIds = servedRecipeIds(plan);
const FP = planFingerprint(planIds);
const otherPlan = makePlan([{ recipe: recipeB }]);

const wine = VOCAB.wines[0];
const principle = VOCAB.principles[0].id;

function validOutput(overrides: { confidence?: number } = {}) {
  return {
    drink: { kind: "wine", styleId: wine.id, name: "Rioja Reserva", confidence: overrides.confidence ?? 0.9 },
    fits: planIds.map((id) => ({ recipeId: id, fit: "great", principleId: principle, avoidReasonId: null })),
  };
}

function modelText(obj: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj) }],
    usage: { input_tokens: 1500, output_tokens: 80 },
    stop_reason: "end_turn",
  };
}

function setSession(userId: string | null, sessionId: string | null) {
  vi.mocked(auth).mockResolvedValue({ userId, sessionId } as unknown as Awaited<ReturnType<typeof auth>>);
}

function setCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === COOKIE && value !== undefined ? { name, value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

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

function jsonReq(body: unknown) {
  return new Request(URL_BOTTLE, {
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
  process.env.PAIRINGS_COOKIE_SECRET = "test-secret-bottle-route";
  vi.mocked(requireUser).mockResolvedValue({ userId: USER, email: "diego@example.com" });
  withState({ plan });
  vi.mocked(claimInflight).mockResolvedValue(true);
  vi.mocked(reserveBottleQuota).mockResolvedValue(1);
  vi.mocked(renewInflight).mockResolvedValue(true);
  vi.mocked(releaseInflight).mockResolvedValue(undefined);
  sharpMock.chain.rotate.mockReturnValue(sharpMock.chain);
  sharpMock.chain.resize.mockReturnValue(sharpMock.chain);
  sharpMock.chain.jpeg.mockReturnValue(sharpMock.chain);
  sharpMock.toBuffer.mockResolvedValue(REENCODED);
  sharpMock.factory.mockReturnValue(sharpMock.chain);
  unlocked();
  create().mockResolvedValue(modelText(validOutput()) as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/pair/bottle", () => {
  it("403 locked without the gate, and never leases or calls the model", async () => {
    locked();
    const res = await POST(jsonReq({ text: "Casamigos reposado", planFingerprint: FP }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "locked" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(claimInflight).not.toHaveBeenCalled();
    expect(create()).not.toHaveBeenCalled();
  });

  it("400 when both image and text are sent", async () => {
    const res = await POST(jsonReq({ image: JPEG_B64, text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(create()).not.toHaveBeenCalled();
  });

  it("400 when neither image nor text is sent", async () => {
    const res = await POST(jsonReq({ planFingerprint: FP }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("400 when the fingerprint is not 8 lowercase hex characters", async () => {
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: "XYZ" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("413 for a body over 1.2 MB without Content-Length, and nothing is counted", async () => {
    const chunk = new Uint8Array(400_000).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const req = new Request(URL_BOTTLE, { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(reserveBottleQuota).not.toHaveBeenCalled();
  });

  it("415 for bytes that are not JPEG, PNG or WebP", async () => {
    const gif = Buffer.from("GIF89a-not-a-jpeg").toString("base64");
    const res = await POST(jsonReq({ image: gif, planFingerprint: FP }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_type" });
    expect(claimInflight).not.toHaveBeenCalled();
  });

  it("415 invalid_image when sharp cannot decode the bytes", async () => {
    sharpMock.toBuffer.mockRejectedValue(new Error("Input buffer has corrupt header"));
    const res = await POST(jsonReq({ image: JPEG_B64, planFingerprint: FP }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "invalid_image" });
  });

  it("413 too_large when the re-encoded JPEG is over 600 KB", async () => {
    sharpMock.toBuffer.mockResolvedValue(Buffer.alloc(600_001));
    const res = await POST(jsonReq({ image: JPEG_B64, planFingerprint: FP }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(create()).not.toHaveBeenCalled();
  });

  it("409 no_plan when the stored state has no plan", async () => {
    withState({ plan: null });
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_plan" });
    expect(create()).not.toHaveBeenCalled();
  });

  it("409 plan_changed when the fingerprint does not match the stored plan", async () => {
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: "00000000" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "plan_changed" });
    expect(claimInflight).not.toHaveBeenCalled();
    expect(create()).not.toHaveBeenCalled();
  });

  it("429 quota when the daily bottle quota is spent", async () => {
    vi.mocked(reserveBottleQuota).mockResolvedValue(null);
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "quota" });
    expect(reserveBottleQuota).toHaveBeenCalledWith(USER);
    expect(create()).not.toHaveBeenCalled();
    expect(releaseInflight).toHaveBeenCalledOnce();
  });

  it("409 busy when the per-user lease is held; same user key as the pairings route", async () => {
    vi.mocked(claimInflight).mockResolvedValue(false);
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "busy" });
    expect(vi.mocked(claimInflight).mock.calls[0][0]).toBe(USER);
    expect(create()).not.toHaveBeenCalled();
    expect(releaseInflight).not.toHaveBeenCalled();
  });

  it("first attempt rejected, second ok: 200, two quota units, problems named on the retry", async () => {
    create()
      .mockResolvedValueOnce(modelText({ drink: "nope" }) as never)
      .mockResolvedValueOnce(modelText(validOutput()) as never);
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(200);
    expect(reserveBottleQuota).toHaveBeenCalledTimes(2);
    expect(create()).toHaveBeenCalledTimes(2);
    const retry = create().mock.calls[1] as unknown as [{ system: string; messages: { content: { text: string }[] }[] }];
    expect(retry[0].messages[0].content[0].text).toContain("Previous attempt problems:");
  });

  it("second attempt rejected too: 422 incomplete", async () => {
    create().mockResolvedValue(modelText({ drink: "nope" }) as never);
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "incomplete" });
    expect(create()).toHaveBeenCalledTimes(2);
    expect(reserveBottleQuota).toHaveBeenCalledTimes(2);
  });

  it("low confidence on an image: 422 cant_read_label, not retried", async () => {
    create().mockResolvedValue(modelText(validOutput({ confidence: 0.2 })) as never);
    const res = await POST(jsonReq({ image: JPEG_B64, planFingerprint: FP }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "cant_read_label" });
    expect(create()).toHaveBeenCalledTimes(1);
  });

  it("low confidence on typed text: 422 unknown_drink", async () => {
    create().mockResolvedValue(modelText(validOutput({ confidence: 0.2 })) as never);
    const res = await POST(jsonReq({ text: "xyz", planFingerprint: FP }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "unknown_drink" });
  });

  it("gate lost between attempts: 403 and no second model call", async () => {
    vi.mocked(getUnlock)
      .mockResolvedValueOnce({ session_id: SESSION, nonce: NONCE })
      .mockResolvedValueOnce(null);
    create().mockResolvedValueOnce(modelText({ drink: "nope" }) as never);
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "locked" });
    expect(create()).toHaveBeenCalledTimes(1);
  });

  it("plan changed while the model worked: 409 and no result in the body", async () => {
    vi.mocked(getSql).mockReturnValue({
      query: vi
        .fn()
        .mockResolvedValueOnce([{ state: { plan } }])
        .mockResolvedValueOnce([{ state: { plan: otherPlan } }]),
    } as unknown as ReturnType<typeof getSql>);
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "plan_changed" });
    expect("result" in body).toBe(false);
    expect(releaseInflight).toHaveBeenCalledOnce();
  });

  it("happy text path: 200 with result, serve line and servedIds", async () => {
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      result: { drink: { kind: string; styleId: string; name: string }; fits: unknown[] };
      serve: string;
      servedIds: string[];
    };
    expect(body.result.drink).toMatchObject({ kind: "wine", styleId: wine.id, name: "Rioja Reserva" });
    expect(body.result.fits).toHaveLength(planIds.length);
    expect(body.serve).toBe(serveLineFor("wine", wine.id));
    expect(body.servedIds).toEqual(planIds);
    const [, opts] = create().mock.calls[0] as unknown as [unknown, { maxRetries?: number }];
    expect(opts.maxRetries).toBe(0);
    expect(releaseInflight).toHaveBeenCalledWith(USER, expect.any(String));
  });

  it("happy image path: only the re-encoded JPEG goes to the model, decoded with the limits", async () => {
    const res = await POST(jsonReq({ image: JPEG_B64, planFingerprint: FP }));
    expect(res.status).toBe(200);
    expect(sharpMock.factory).toHaveBeenCalledWith(expect.any(Buffer), {
      limitInputPixels: 40_000_000,
      failOn: "error",
    });
    const [params] = create().mock.calls[0] as unknown as [
      { messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[] },
    ];
    const image = params.messages[0].content[0];
    expect(image.type).toBe("image");
    expect(image.source).toEqual({ type: "base64", media_type: "image/jpeg", data: REENCODED.toString("base64") });
  });

  it("a provider failure gives 503 unavailable and releases the lease", async () => {
    create().mockRejectedValue(new Error("upstream down"));
    const res = await POST(jsonReq({ text: "Rioja", planFingerprint: FP }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(releaseInflight).toHaveBeenCalledOnce();
  });
});
