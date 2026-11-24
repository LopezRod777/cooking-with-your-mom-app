import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWelcome, welcomeEmail } from "../email/welcome";

const original = process.env.RESEND_API_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = original;
});

describe("welcome email", () => {
  it("greets by first name, links the app, and falls back to honey", () => {
    const m = welcomeEmail("Ana", "https://example.test");
    expect(m.subject).toBe("You’re in, Ana. Mama saved you a seat.");
    expect(m.text).toContain("Come on in: https://example.test");
    expect(m.html).toContain('href="https://example.test"');
    expect(m.html).not.toContain("undefined");
    expect(welcomeEmail(null).subject).toContain("honey");
    expect(welcomeEmail("<b>x</b>").html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("links production when the app origin is empty or not https", () => {
    const prev = process.env.NEXT_PUBLIC_APP_ORIGIN;
    process.env.NEXT_PUBLIC_APP_ORIGIN = "";
    expect(welcomeEmail("A").text).toContain("Come on in: https://cookingwithyourmom.zouthrock.com");
    process.env.NEXT_PUBLIC_APP_ORIGIN = "http://localhost:3000";
    expect(welcomeEmail("A").html).toContain('href="https://cookingwithyourmom.zouthrock.com"');
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_ORIGIN;
    else process.env.NEXT_PUBLIC_APP_ORIGIN = prev;
  });

  it("does not call Resend without a key, and reports it", async () => {
    delete process.env.RESEND_API_KEY;
    const f = vi.fn();
    expect(await sendWelcome({ to: "a@example.com", firstName: "A", userId: "user_1" }, f as unknown as typeof fetch)).toEqual({ sent: false, reason: "no_key" });
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to Resend with an idempotency key per user and returns the id", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    const r = await sendWelcome({ to: "a@example.com", firstName: "A", userId: "user_1" }, f as unknown as typeof fetch);
    expect(r).toEqual({ sent: true, id: "em_1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("welcome/user_1");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["a@example.com"]);
    expect(body.reply_to).toBe("hello@example.com");
  });

  it("reports a Resend failure instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const f = vi.fn(async () => new Response("nope", { status: 422 }));
    expect(await sendWelcome({ to: "a@example.com", firstName: null, userId: "u" }, f as unknown as typeof fetch)).toEqual({ sent: false, reason: "resend_422" });
  });
});
