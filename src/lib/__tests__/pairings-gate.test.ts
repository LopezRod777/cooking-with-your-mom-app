import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { requireUser } from "../auth/requireUser";
import {
  COOKIE,
  cookieAttributes,
  requirePairingsGate,
  signUnlock,
  verifyUnlockCookie,
} from "../pairings/cookie";
import { createUnlock, deleteUnlock, getUnlock } from "../pairings/db";
import { POST as unlockPost } from "../../app/api/pair/unlock/route";
import { POST as lockPost } from "../../app/api/pair/lock/route";
import { GET as statusGet } from "../../app/api/pair/status/route";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn() }));
vi.mock("../pairings/db", () => ({
  createUnlock: vi.fn(),
  getUnlock: vi.fn(),
  deleteUnlock: vi.fn(),
}));

const SECRET = "test-secret-not-the-real-one";
const originalSecret = process.env.PAIRINGS_COOKIE_SECRET;

function setCookieJar(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === COOKIE && value !== undefined ? { name, value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function setSession(userId: string | null, sessionId: string | null) {
  vi.mocked(auth).mockResolvedValue({ userId, sessionId } as unknown as Awaited<ReturnType<typeof auth>>);
}

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/pair/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAIRINGS_COOKIE_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.PAIRINGS_COOKIE_SECRET;
  else process.env.PAIRINGS_COOKIE_SECRET = originalSecret;
});

describe("cookie sign/verify", () => {
  const nonce = "a".repeat(64);
  const value = () => signUnlock("user_1", "sess_1", nonce);

  it("accepts the cookie for the same user, session and nonce", () => {
    expect(verifyUnlockCookie(value(), "user_1", "sess_1", nonce)).toBe(true);
  });

  it("rejects another user", () => {
    expect(verifyUnlockCookie(value(), "user_2", "sess_1", nonce)).toBe(false);
  });

  it("rejects another session of the same user", () => {
    expect(verifyUnlockCookie(value(), "user_1", "sess_2", nonce)).toBe(false);
  });

  it("rejects a different nonce (row was replaced or deleted)", () => {
    expect(verifyUnlockCookie(value(), "user_1", "sess_1", "b".repeat(64))).toBe(false);
    expect(verifyUnlockCookie(value(), "user_1", "sess_1", null)).toBe(false);
  });

  it("rejects a tampered value", () => {
    const [sid, sig] = value().split(".");
    const forgedSid = Buffer.from("sess_2", "utf8").toString("base64url");
    expect(verifyUnlockCookie(`${forgedSid}.${sig}`, "user_1", "sess_1", nonce)).toBe(false);
    expect(verifyUnlockCookie(`${sid}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`, "user_1", "sess_1", nonce)).toBe(false);
    expect(verifyUnlockCookie(undefined, "user_1", "sess_1", nonce)).toBe(false);
  });

  it("throws when the secret is missing", () => {
    delete process.env.PAIRINGS_COOKIE_SECRET;
    expect(() => signUnlock("user_1", "sess_1", nonce)).toThrow(/PAIRINGS_COOKIE_SECRET/);
  });

  it("cookie attributes: httpOnly, lax, path /, no maxAge", () => {
    const attrs = cookieAttributes();
    expect(attrs).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(attrs).not.toHaveProperty("maxAge");
  });
});

describe("requirePairingsGate", () => {
  const nonce = "c".repeat(64);

  it("locked when there is no cookie", async () => {
    setSession("user_1", "sess_1");
    setCookieJar(undefined);
    const res = await requirePairingsGate();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
    expect(getUnlock).not.toHaveBeenCalled();
  });

  it("passes with a valid cookie and matching row", async () => {
    setSession("user_1", "sess_1");
    setCookieJar(signUnlock("user_1", "sess_1", nonce));
    vi.mocked(getUnlock).mockResolvedValue({ session_id: "sess_1", nonce });
    expect(await requirePairingsGate()).toEqual({ userId: "user_1" });
  });

  it("locked when the session changed", async () => {
    setSession("user_1", "sess_2");
    setCookieJar(signUnlock("user_1", "sess_1", nonce));
    vi.mocked(getUnlock).mockResolvedValue({ session_id: "sess_1", nonce });
    expect(((await requirePairingsGate()) as Response).status).toBe(403);
  });

  it("locked after the row is deleted (lock)", async () => {
    setSession("user_1", "sess_1");
    setCookieJar(signUnlock("user_1", "sess_1", nonce));
    vi.mocked(getUnlock).mockResolvedValue(null);
    expect(((await requirePairingsGate()) as Response).status).toBe(403);
  });

  it("locked when signed out", async () => {
    setSession(null, null);
    expect(((await requirePairingsGate()) as Response).status).toBe(403);
  });
});

describe("unlock route", () => {
  it("sets the cookie and returns unlocked true", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user_1", email: "a@example.com" });
    setSession("user_1", "sess_1");
    vi.mocked(createUnlock).mockResolvedValue("d".repeat(64));

    const res = await unlockPost(jsonReq({ confirm: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unlocked: true });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(createUnlock).toHaveBeenCalledWith("user_1", "sess_1");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Max-Age|Expires/i);
    const value = decodeURIComponent(/cwym_over21=([^;]+)/.exec(setCookie)![1]);
    expect(verifyUnlockCookie(value, "user_1", "sess_1", "d".repeat(64))).toBe(true);
  });

  it("400 without confirm, no unlock created", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user_1", email: "a@example.com" });
    setSession("user_1", "sess_1");
    const res = await unlockPost(jsonReq({ confirm: false }));
    expect(res.status).toBe(400);
    expect(createUnlock).not.toHaveBeenCalled();
  });

  it("passes the requireUser rejection through", async () => {
    vi.mocked(requireUser).mockResolvedValue(Response.json({ error: "not_invited" }, { status: 403 }));
    const res = await unlockPost(jsonReq({ confirm: true }));
    expect(res.status).toBe(403);
    expect(createUnlock).not.toHaveBeenCalled();
  });
});

describe("status route", () => {
  it("unlocked false without cookie", async () => {
    setSession("user_1", "sess_1");
    setCookieJar(undefined);
    const res = await statusGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unlocked: false });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("unlocked true with a valid cookie", async () => {
    setSession("user_1", "sess_1");
    setCookieJar(signUnlock("user_1", "sess_1", "e".repeat(64)));
    vi.mocked(getUnlock).mockResolvedValue({ session_id: "sess_1", nonce: "e".repeat(64) });
    expect(await (await statusGet()).json()).toEqual({ unlocked: true });
  });
});

describe("lock route", () => {
  it("deletes the row and clears the cookie", async () => {
    setSession("user_1", "sess_1");
    const res = await lockPost();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unlocked: false });
    expect(deleteUnlock).toHaveBeenCalledWith("user_1");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${COOKIE}=;`);
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("clears the cookie even when signed out, without touching the db", async () => {
    setSession(null, null);
    const res = await lockPost();
    expect(await res.json()).toEqual({ unlocked: false });
    expect(deleteUnlock).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});
