import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, currentUser } from "@clerk/nextjs/server";
import { _resetRequireUserCache, isAllowedEmail, requireAdmin, requireUser, sameOrigin } from "../auth/requireUser";
import { firstSeen, getMember } from "../auth/members";
import { notifyNewMember } from "../email/newMember";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), currentUser: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "ana" }) })) }));
vi.mock("../auth/members", () => ({ getMember: vi.fn(async () => null), firstSeen: vi.fn() }));
vi.mock("../email/newMember", () => ({ notifyNewMember: vi.fn(async () => ({ sent: true })) }));

type ClerkUser = Awaited<ReturnType<typeof currentUser>>;

function clerkUser(email: string, status: string | null = "verified"): ClerkUser {
  const address = {
    emailAddress: email,
    verification: status === null ? null : { status },
  };
  return { primaryEmailAddress: address, emailAddresses: [address] } as unknown as ClerkUser;
}

const originalAllowed = process.env.ALLOWED_EMAILS;
const originalMode = process.env.SIGNUP_MODE;
const originalAdmins = process.env.ADMIN_EMAILS;

beforeEach(() => {
  _resetRequireUserCache();
  vi.clearAllMocks();
  vi.mocked(getMember).mockResolvedValue(null);
  vi.mocked(notifyNewMember).mockResolvedValue({ sent: true });
  process.env.ALLOWED_EMAILS = "a@example.com, B@Example.com ,";
  delete process.env.SIGNUP_MODE;
  delete process.env.ADMIN_EMAILS;
});

afterEach(() => {
  if (originalAllowed === undefined) delete process.env.ALLOWED_EMAILS;
  else process.env.ALLOWED_EMAILS = originalAllowed;
  if (originalMode === undefined) delete process.env.SIGNUP_MODE;
  else process.env.SIGNUP_MODE = originalMode;
  if (originalAdmins === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = originalAdmins;
  vi.restoreAllMocks();
});

const session = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as unknown as Awaited<ReturnType<typeof auth>>);
const member = (userId: string, email: string, status: "waiting" | "approved" | "blocked", ref: string | null = null) => ({ userId, email, status, ref, createdAt: "2026-11-03T00:00:00.000Z", decidedAt: null, decidedBy: null, welcomedAt: null });

describe("isAllowedEmail", () => {
  it("compares case-insensitively and ignores spaces and empty entries", () => {
    expect(isAllowedEmail("b@example.COM", " a@example.com, B@Example.com ,")).toBe(true);
    expect(isAllowedEmail("c@example.com", "a@example.com,b@example.com")).toBe(false);
    expect(isAllowedEmail("", "a@example.com")).toBe(false);
    expect(isAllowedEmail("a@example.com", "")).toBe(false);
  });
});

describe("requireUser", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as unknown as Awaited<ReturnType<typeof auth>>);
    const res = await requireUser();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
    expect(await (res as Response).json()).toEqual({ error: "unauthorized" });
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("returns 403 and warns when ALLOWED_EMAILS is empty", async () => {
    process.env.ALLOWED_EMAILS = " , ,";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as unknown as Awaited<ReturnType<typeof auth>>);
    const res = (await requireUser()) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_invited" });
    expect(warn).toHaveBeenCalledWith("[auth] ALLOWED_EMAILS is empty: nobody is allowed");
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("returns 403 when the verified email is not in the list", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_2" } as unknown as Awaited<ReturnType<typeof auth>>);
    vi.mocked(currentUser).mockResolvedValue(clerkUser("intruder@example.com"));
    const res = (await requireUser()) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_invited" });
  });

  it("returns 503 (not a closed door) when Clerk cannot return the user or the lookup throws", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(currentUser).mockResolvedValue(null);
    let res = (await requireUser()) as Response;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_unavailable" });
    expect(res.headers.get("Retry-After")).toBe("5");
    vi.mocked(currentUser).mockRejectedValue(new Error("clerk down"));
    res = (await requireUser()) as Response;
    expect(res.status).toBe(503);
    // Nothing was cached: the next good answer gets through.
    vi.mocked(currentUser).mockResolvedValue(clerkUser("a@example.com"));
    expect(await requireUser()).toEqual({ userId: "user_1", email: "a@example.com" });
  });

  it("returns 403 when the email is not verified", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_3" } as unknown as Awaited<ReturnType<typeof auth>>);
    vi.mocked(currentUser).mockResolvedValue(clerkUser("a@example.com", "unverified"));
    const res = (await requireUser()) as Response;
    expect(res.status).toBe(403);
  });

  it("returns 403 when the primary email has no verification object", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_4" } as unknown as Awaited<ReturnType<typeof auth>>);
    vi.mocked(currentUser).mockResolvedValue(clerkUser("a@example.com", null));
    const res = (await requireUser()) as Response;
    expect(res.status).toBe(403);
  });

  it("returns the user when allowed (case-insensitive)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_5" } as unknown as Awaited<ReturnType<typeof auth>>);
    vi.mocked(currentUser).mockResolvedValue(clerkUser("  B@EXAMPLE.com "));
    const res = await requireUser();
    expect(res).toEqual({ userId: "user_5", email: "b@example.com" });
  });

  it("caches the decision per userId: a second call does not hit currentUser", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_6" } as unknown as Awaited<ReturnType<typeof auth>>);
    vi.mocked(currentUser).mockResolvedValue(clerkUser("a@example.com"));
    await requireUser();
    await requireUser();
    expect(currentUser).toHaveBeenCalledTimes(1);
  });

  it("refetches after the 10 minute TTL", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(auth).mockResolvedValue({ userId: "user_7" } as unknown as Awaited<ReturnType<typeof auth>>);
      vi.mocked(currentUser).mockResolvedValue(clerkUser("a@example.com"));
      await requireUser();
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      await requireUser();
      expect(currentUser).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("requireUser: waitlist and open modes", () => {
  it("waitlist: first sight creates a waiting row with the referral and answers 403 waiting", async () => {
    process.env.SIGNUP_MODE = "waitlist";
    session("user_w1");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("new@example.com"));
    vi.mocked(firstSeen).mockResolvedValue({ member: member("user_w1", "new@example.com", "waiting"), created: true });
    const res = (await requireUser()) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "waiting" });
    expect(firstSeen).toHaveBeenCalledWith("user_w1", "new@example.com", "waiting", "ana");
  });

  it("waitlist: a new waiting row notifies the admins once, with the email, referral and user id", async () => {
    process.env.SIGNUP_MODE = "waitlist";
    session("user_n1");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("fresh@example.com"));
    vi.mocked(firstSeen).mockResolvedValue({ member: member("user_n1", "fresh@example.com", "waiting", "whatsapp"), created: true });
    const res = (await requireUser()) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "waiting" });
    expect(notifyNewMember).toHaveBeenCalledTimes(1);
    expect(notifyNewMember).toHaveBeenCalledWith({ email: "fresh@example.com", ref: "whatsapp", userId: "user_n1" });
  });

  it("waitlist: a row that already existed does not notify again", async () => {
    process.env.SIGNUP_MODE = "waitlist";
    session("user_n2");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("again@example.com"));
    vi.mocked(firstSeen).mockResolvedValue({ member: member("user_n2", "again@example.com", "waiting"), created: false });
    expect(((await requireUser()) as Response).status).toBe(403);
    expect(notifyNewMember).not.toHaveBeenCalled();
  });

  it("open: a new approved row does not send the admin heads-up", async () => {
    process.env.SIGNUP_MODE = "open";
    session("user_o2");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("walkin@example.com"));
    vi.mocked(firstSeen).mockResolvedValue({ member: member("user_o2", "walkin@example.com", "approved"), created: true });
    expect(await requireUser()).toEqual({ userId: "user_o2", email: "walkin@example.com" });
    expect(notifyNewMember).not.toHaveBeenCalled();
  });

  it("waitlist: an approved member gets in and the decision is cached (no second lookup)", async () => {
    process.env.SIGNUP_MODE = "waitlist";
    session("user_w2");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("ok@example.com"));
    vi.mocked(getMember).mockResolvedValue(member("user_w2", "ok@example.com", "approved"));
    expect(await requireUser()).toEqual({ userId: "user_w2", email: "ok@example.com" });
    expect(await requireUser()).toEqual({ userId: "user_w2", email: "ok@example.com" });
    expect(getMember).toHaveBeenCalledTimes(1);
    expect(firstSeen).not.toHaveBeenCalled();
  });

  it("waitlist: a waiting answer is not cached, so an approval lands on the next request", async () => {
    process.env.SIGNUP_MODE = "waitlist";
    session("user_w3");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("soon@example.com"));
    vi.mocked(getMember).mockResolvedValueOnce(member("user_w3", "soon@example.com", "waiting"));
    expect(((await requireUser()) as Response).status).toBe(403);
    vi.mocked(getMember).mockResolvedValueOnce(member("user_w3", "soon@example.com", "approved"));
    expect(await requireUser()).toEqual({ userId: "user_w3", email: "soon@example.com" });
  });

  it("blocked wins over the invite list, in every mode", async () => {
    for (const mode of ["invite", "waitlist", "open"]) {
      _resetRequireUserCache();
      process.env.SIGNUP_MODE = mode;
      session("user_b");
      vi.mocked(currentUser).mockResolvedValue(clerkUser("a@example.com"));
      vi.mocked(getMember).mockResolvedValue(member("user_b", "a@example.com", "blocked"));
      const res = (await requireUser()) as Response;
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "blocked" });
    }
  });

  it("waitlist: an empty invite list does not close the door", async () => {
    process.env.SIGNUP_MODE = "waitlist";
    process.env.ALLOWED_EMAILS = "";
    session("user_w4");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("ok2@example.com"));
    vi.mocked(getMember).mockResolvedValue(member("user_w4", "ok2@example.com", "approved"));
    expect(await requireUser()).toEqual({ userId: "user_w4", email: "ok2@example.com" });
  });

  it("open: first sight creates an approved row and gets in", async () => {
    process.env.SIGNUP_MODE = "open";
    session("user_o1");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("anyone@example.com"));
    vi.mocked(firstSeen).mockResolvedValue({ member: member("user_o1", "anyone@example.com", "approved"), created: true });
    expect(await requireUser()).toEqual({ userId: "user_o1", email: "anyone@example.com" });
    expect(firstSeen).toHaveBeenCalledWith("user_o1", "anyone@example.com", "approved", "ana");
  });

  it("an unknown SIGNUP_MODE behaves as invite (fails closed)", async () => {
    process.env.SIGNUP_MODE = "everyone";
    session("user_x");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("stranger@example.com"));
    const res = (await requireUser()) as Response;
    expect(await res.json()).toEqual({ error: "not_invited" });
    expect(firstSeen).not.toHaveBeenCalled();
  });

  it("an admin email gets in without being invited or approved", async () => {
    process.env.SIGNUP_MODE = "waitlist";
    process.env.ADMIN_EMAILS = "boss@example.com";
    session("user_adm");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("boss@example.com"));
    expect(await requireUser()).toEqual({ userId: "user_adm", email: "boss@example.com" });
    expect(firstSeen).not.toHaveBeenCalled();
  });
});

describe("requireAdmin and sameOrigin", () => {
  it("404 for a signed-in non-admin, ok for an admin, 404 for a blocked admin", async () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    session("user_1");
    vi.mocked(currentUser).mockResolvedValue(clerkUser("a@example.com"));
    expect(((await requireAdmin()) as Response).status).toBe(404);
    vi.mocked(currentUser).mockResolvedValue(clerkUser("boss@example.com"));
    expect(await requireAdmin()).toEqual({ userId: "user_1", email: "boss@example.com" });
    vi.mocked(getMember).mockResolvedValue(member("user_1", "boss@example.com", "blocked"));
    expect(((await requireAdmin()) as Response).status).toBe(404);
  });

  it("sameOrigin accepts same-origin fetches and a matching Origin, rejects the rest", () => {
    const mk = (h: Record<string, string>) => new Request("https://app.example.com/api/admin/members", { method: "POST", headers: h });
    expect(sameOrigin(mk({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOrigin(mk({ origin: "https://app.example.com" }))).toBe(true);
    expect(sameOrigin(mk({ origin: "https://evil.example.com" }))).toBe(false);
    expect(sameOrigin(mk({}))).toBe(false);
  });
});
