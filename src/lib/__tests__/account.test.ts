import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_HEADER, otherAccount, withAccount } from "../auth/account";

const ORIGIN = "https://app.test";
const setup = (id: string | null) => {
  const real = vi.fn<(i: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response("ok"));
  const call = withAccount(real as unknown as typeof fetch, () => id, ORIGIN);
  const sent = () => new Headers(real.mock.calls[0][1]?.headers).get(ACCOUNT_HEADER);
  return { real, call, sent };
};

describe("otherAccount", () => {
  it("refuses a tab that holds another account, and only that", async () => {
    const res = otherAccount(new Headers({ [ACCOUNT_HEADER]: "user_A" }), "user_B");
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "other_account" });
    expect(otherAccount(new Headers({ [ACCOUNT_HEADER]: "user_B" }), "user_B")).toBeNull();
    expect(otherAccount(new Headers(), "user_B")).toBeNull();
  });
});

describe("withAccount", () => {
  it("says whose tab it is on our own API, keeping the rest of the call", async () => {
    const t = setup("user_A");
    await t.call("/api/wellness", { method: "POST", body: "x", headers: { "content-type": "application/json" } });
    expect(t.sent()).toBe("user_A");
    const init = t.real.mock.calls[0][1]!;
    expect(init).toMatchObject({ method: "POST", body: "x" });
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("never replaces a header already there", async () => {
    const t = setup("user_A");
    await t.call(new URL(`${ORIGIN}/api/state`), { headers: { [ACCOUNT_HEADER]: "user_X" } });
    expect(t.sent()).toBe("user_X");
  });

  it.each(["https://clerk.other.test/api/x", "/recipe/api/x", "/_next/data", "https://app.test.evil.test/api/state"])("says nothing to %s", async (url) => {
    const t = setup("user_A");
    await t.call(url);
    expect(t.sent()).toBeNull();
  });

  it("says nothing while nobody is signed in", async () => {
    const t = setup(null);
    await t.call("/api/state");
    expect(t.sent()).toBeNull();
  });
});

describe("withAccount with a Request", () => {
  it("adds the account and keeps the Request's own headers", async () => {
    const t = setup("user_A");
    await t.call(new Request(`${ORIGIN}/api/wellness`, { method: "POST", body: "x", headers: { "x-own": "1" } }));
    expect(t.sent()).toBe("user_A");
    expect(new Headers(t.real.mock.calls[0][1]?.headers).get("x-own")).toBe("1");
  });
});

describe("pinDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps the first account for the life of the document", async () => {
    vi.stubGlobal("window", {});
    const { documentAccount, pinDocument } = await import("../auth/account");
    expect(documentAccount()).toBeNull();
    expect(pinDocument("user_A")).toBe("user_A");
    expect(pinDocument("user_B")).toBe("user_A");
    expect(documentAccount()).toBe("user_A");
  });

  it("keeps nothing on the server, which renders for many people", async () => {
    vi.resetModules();
    const { documentAccount, pinDocument } = await import("../auth/account");
    expect(pinDocument("user_A")).toBe("user_A");
    expect(pinDocument("user_B")).toBe("user_B");
    expect(documentAccount()).toBeNull();
  });
});
