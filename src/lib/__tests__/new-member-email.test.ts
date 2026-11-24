import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newMemberEmail, notifyNewMember } from "../email/newMember";

const keys = ["RESEND_API_KEY", "ADMIN_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of keys) saved[k] = process.env[k];
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.ADMIN_EMAILS;
});

afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ id: "em_2" }), { status: 200 }));

describe("newMemberEmail", () => {
  it("names the new member in the subject and points Diego to /admin", () => {
    const m = newMemberEmail({ email: "ana@example.com", ref: null, appUrl: "https://example.test" });
    expect(m.subject).toBe("ana@example.com is on Mama's list");
    expect(m.subject).toContain("ana@example.com");
    expect(m.text).toContain("/admin");
    expect(m.text).toContain("https://example.test/admin");
    expect(m.text).not.toContain("came in through");
    expect(m.html).toContain('href="https://example.test/admin"');
  });

  it("mentions the referral when there is one", () => {
    const m = newMemberEmail({ email: "ana@example.com", ref: "whatsapp", appUrl: "https://example.test" });
    expect(m.text).toContain("(came in through whatsapp)");
  });
});

describe("notifyNewMember", () => {
  it("sends to every admin, replies to the member, and keys the send by user", async () => {
    process.env.ADMIN_EMAILS = "a@x.com, b@x.com";
    const f = okFetch();
    const r = await notifyNewMember({ email: "new@example.com", ref: "correo", userId: "user_9" }, f as unknown as typeof fetch);
    expect(r).toEqual({ sent: true });
    // One request per admin, so one bad address never blocks the other.
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("new-member-user_9-0");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["a@x.com"]);
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).to).toEqual(["b@x.com"]);
    expect(body.reply_to).toBe("new@example.com");
    expect(body.subject).toBe("new@example.com is on Mama's list");
  });

  it("sends nothing when ADMIN_EMAILS is empty", async () => {
    process.env.ADMIN_EMAILS = " , ";
    const f = okFetch();
    expect(await notifyNewMember({ email: "n@example.com", ref: null, userId: "u" }, f as unknown as typeof fetch)).toEqual({ sent: false, reason: "no_admins" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sends nothing without RESEND_API_KEY", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.ADMIN_EMAILS = "a@x.com";
    const f = okFetch();
    expect(await notifyNewMember({ email: "n@example.com", ref: null, userId: "u" }, f as unknown as typeof fetch)).toEqual({ sent: false, reason: "no_key" });
    expect(f).not.toHaveBeenCalled();
  });

  it("reports a Resend failure instead of throwing", async () => {
    process.env.ADMIN_EMAILS = "a@x.com";
    const f = vi.fn(async () => new Response("nope", { status: 500 }));
    expect(await notifyNewMember({ email: "n@example.com", ref: null, userId: "u" }, f as unknown as typeof fetch)).toEqual({ sent: false, reason: "resend_500" });
  });

  it("reports a network error instead of throwing", async () => {
    process.env.ADMIN_EMAILS = "a@x.com";
    const f = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    expect(await notifyNewMember({ email: "n@example.com", ref: null, userId: "u" }, f as unknown as typeof fetch)).toEqual({ sent: false, reason: "socket hang up" });
  });
});
