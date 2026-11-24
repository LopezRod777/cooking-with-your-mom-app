import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db";
import { requireUser } from "../auth/requireUser";
import { DEFAULT_STATE } from "../schemas";
import { GET, PUT } from "../../app/api/state/route";

vi.mock("../db", () => ({ getSql: vi.fn() }));
vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn() }));

type Call = { text: string; params: unknown[] };
type Row = Record<string, unknown>;

// Fake de sql.query: registra cada llamada y devuelve filas programadas en orden.
function fakeSql(scripted: Row[][] = []) {
  const calls: Call[] = [];
  const queue = [...scripted];
  const query = vi.fn(async (text: string, params: unknown[]) => {
    calls.push({ text, params });
    return queue.shift() ?? [];
  });
  vi.mocked(getSql).mockReturnValue({ query } as unknown as ReturnType<typeof getSql>);
  return { calls, query };
}

let signedIn = "";
function asUser(userId: string) {
  signedIn = userId;
  vi.mocked(requireUser).mockResolvedValue({ userId, email: `${userId}@example.com` });
}

function putReq(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/state", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(signedIn ? { "x-cwym-user": signedIn } : {}), ...headers },
    body: text,
  });
}

const validBody = { baseRevision: 0, state: DEFAULT_STATE };
const savedAt = new Date("2026-10-30T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth passthrough", () => {
  it("GET returns the requireUser response unchanged", async () => {
    const denied = Response.json({ error: "unauthorized" }, { status: 401 });
    vi.mocked(requireUser).mockResolvedValue(denied);
    const res = await GET();
    expect(res).toBe(denied);
    expect(getSql).not.toHaveBeenCalled();
  });

  it("PUT returns the requireUser response unchanged", async () => {
    const denied = Response.json({ error: "not_invited" }, { status: 403 });
    vi.mocked(requireUser).mockResolvedValue(denied);
    const res = await PUT(putReq(validBody));
    expect(res).toBe(denied);
    expect(getSql).not.toHaveBeenCalled();
  });
});

describe("a tab holding another account", () => {
  it("GET and PUT answer 403 and never touch the database", async () => {
    asUser("user_b");
    const headers = { "x-cwym-user": "user_a" };
    const read = await GET(new Request("http://localhost/api/state", { headers }));
    const write = await PUT(putReq(validBody, headers));
    expect([read.status, await read.json(), write.status]).toEqual([403, { error: "other_account" }, 403]);
    expect(getSql).not.toHaveBeenCalled();
  });

  it("a PUT that does not say whose data it holds (old tab) is told to reload, and nothing is written", async () => {
    asUser("user_a");
    const res = await PUT(new Request("http://localhost/api/state", { method: "PUT", body: JSON.stringify(validBody) }));
    expect([res.status, await res.json()]).toEqual([400, { error: "outdated_client" }]);
    expect(getSql).not.toHaveBeenCalled();
  });

  it("the same account, or a read that does not say, goes through", async () => {
    asUser("user_a");
    fakeSql([[], []]);
    expect((await GET(new Request("http://localhost/api/state", { headers: { "x-cwym-user": "user_a" } }))).status).toBe(200);
    expect((await GET(new Request("http://localhost/api/state"))).status).toBe(200);
  });
});

describe("GET /api/state", () => {
  it("no row -> revision 0, state null", async () => {
    asUser("user_a");
    fakeSql([[]]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: 0, state: null, updatedAt: null });
  });

  it("row -> revision, state and ISO updatedAt", async () => {
    asUser("user_a");
    fakeSql([[{ revision: 4, state: DEFAULT_STATE, updated_at: savedAt }]]);
    const res = await GET();
    expect(await res.json()).toEqual({ revision: 4, state: DEFAULT_STATE, updatedAt: savedAt.toISOString() });
  });
});

describe("PUT /api/state limits and validation", () => {
  it("413 when content-length is over 512 KB", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const res = await PUT(putReq(validBody, { "content-length": "600000" }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(query).not.toHaveBeenCalled();
  });

  it("413 when the body itself is over 512 KB", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const big = JSON.stringify({ baseRevision: 0, state: DEFAULT_STATE, pad: "a".repeat(524300) });
    const res = await PUT(putReq(big));
    expect(res.status).toBe(413);
    expect(query).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON", async () => {
    asUser("user_a");
    fakeSql();
    const res = await PUT(putReq("{no json"));
    expect(res.status).toBe(400);
  });

  it("400 on schema failure", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const res = await PUT(putReq({ baseRevision: -1, state: DEFAULT_STATE }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("invalid");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("400 when favorites exceed 300", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const state = { ...DEFAULT_STATE, favorites: Array.from({ length: 301 }, (_, i) => `r${i}`) };
    const res = await PUT(putReq({ baseRevision: 0, state }));
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("PUT /api/state pets", () => {
  const pet = (i: number) => ({
    id: `pet_id${i}00`,
    name: `P${i}`,
    species: "cat",
    weightKg: 4,
    bornYearMonth: "2024-01",
    neutered: true,
    extrasLog: [],
  });

  it("PUT without pets -> 400 outdated_client", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const old: Record<string, unknown> = { ...DEFAULT_STATE };
    delete old.pets;
    const res = await PUT(putReq({ baseRevision: 0, state: old }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("outdated_client");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("7 pets -> 400 invalid", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const state = { ...DEFAULT_STATE, pets: Array.from({ length: 7 }, (_, i) => pet(i)) };
    const res = await PUT(putReq({ baseRevision: 0, state }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("duplicate pet ids -> 400 invalid", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const state = { ...DEFAULT_STATE, pets: [pet(1), pet(1)] };
    const res = await PUT(putReq({ baseRevision: 0, state }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid");
    expect(query).not.toHaveBeenCalled();
  });
});

describe("PUT /api/state schema 3 (pet photo and breed)", () => {
  it("full new body (schema 3, pets, places) -> 200", async () => {
    asUser("user_a");
    const { query } = fakeSql([[{ revision: 1, updated_at: savedAt }]]);
    const state = { ...DEFAULT_STATE, places: { saved: [{ id: "loc_abc12345", label: "02143", radiusMiles: 3 as const }], activeId: "loc_abc12345" } };
    const res = await PUT(putReq({ baseRevision: 0, state }));
    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledOnce();
  });

  it("PUT without schema -> 400 outdated_client", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const old: Record<string, unknown> = { ...DEFAULT_STATE };
    delete old.schema;
    const res = await PUT(putReq({ baseRevision: 0, state: old }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("outdated_client");
    expect(query).not.toHaveBeenCalled();
  });

  it("schema 3 but no places -> 400 outdated_client", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const old: Record<string, unknown> = { ...DEFAULT_STATE, schema: 3 };
    delete old.places;
    const res = await PUT(putReq({ baseRevision: 0, state: old }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("outdated_client");
    expect(query).not.toHaveBeenCalled();
  });

  it("a schema 2 client (full body, pets and places present, no photo or breed) -> 400 outdated_client", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const v2 = { ...DEFAULT_STATE, schema: 2 };
    const res = await PUT(putReq({ baseRevision: 0, state: v2 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("outdated_client");
    expect(query).not.toHaveBeenCalled();
  });

  it("a schema 3 client (full body, pets and places present, no drinks budget) -> 400 outdated_client", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const v3 = { ...DEFAULT_STATE, schema: 3 };
    const res = await PUT(putReq({ baseRevision: 0, state: v3 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("outdated_client");
    expect(query).not.toHaveBeenCalled();
  });

  it("schema 5 without profile.drinksBudgetUsd -> 400 invalid (not outdated), nothing written", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const profile: Record<string, unknown> = { ...DEFAULT_STATE.profile };
    delete profile.drinksBudgetUsd;
    const res = await PUT(putReq({ baseRevision: 0, state: { ...DEFAULT_STATE, profile } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("schema 5 with drinksBudgetUsd 25 is stored as sent", async () => {
    asUser("user_a");
    const { calls } = fakeSql([[{ revision: 1, updated_at: savedAt }]]);
    const state = { ...DEFAULT_STATE, profile: { ...DEFAULT_STATE.profile, drinksBudgetUsd: 25 } };
    const res = await PUT(putReq({ baseRevision: 0, state }));
    expect(res.status).toBe(200);
    expect(JSON.parse(String(calls[0].params[1])).profile.drinksBudgetUsd).toBe(25);
  });
});

describe("PUT /api/state schema 5 (kitchen)", () => {
  it("schema 4 body (full, pets and places present, no kitchen) -> 400 outdated_client, nothing written", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const v4 = { ...DEFAULT_STATE, schema: 4 };
    const res = await PUT(putReq({ baseRevision: 0, state: v4 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("outdated_client");
    expect(query).not.toHaveBeenCalled();
  });

  it("schema 5 whose profile lacks kitchen -> 400 outdated_client, nothing written", async () => {
    asUser("user_a");
    const { query } = fakeSql();
    const profile: Record<string, unknown> = { ...DEFAULT_STATE.profile };
    delete profile.kitchen;
    const res = await PUT(putReq({ baseRevision: 0, state: { ...DEFAULT_STATE, profile } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("outdated_client");
    expect(query).not.toHaveBeenCalled();
  });

  it("schema 5 with profile.kitchen null -> 200", async () => {
    asUser("user_a");
    const { query } = fakeSql([[{ revision: 1, updated_at: savedAt }]]);
    const res = await PUT(putReq({ baseRevision: 0, state: DEFAULT_STATE }));
    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledOnce();
  });
});

describe("PUT /api/state writes", () => {
  it("baseRevision 0 inserts and returns revision 1", async () => {
    asUser("user_a");
    const { calls } = fakeSql([[{ revision: 1, updated_at: savedAt }]]);
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: 1, updatedAt: savedAt.toISOString() });
    expect(calls[0].text).toMatch(/^insert into app_state/);
    expect(calls[0].text).toMatch(/on conflict \(user_id\) do nothing returning/);
    expect(calls[0].params[0]).toBe("user_a");
  });

  it("baseRevision 0 with an existing row -> 409 with the server state", async () => {
    asUser("user_a");
    const server = { ...DEFAULT_STATE, checked: ["x"] };
    fakeSql([[], [{ revision: 3, state: server, updated_at: savedAt }]]);
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      revision: 3,
      state: server,
      updatedAt: savedAt.toISOString(),
    });
  });

  it("baseRevision n updates with revision = revision + 1 and returns it", async () => {
    asUser("user_a");
    const { calls } = fakeSql([[{ revision: 5, updated_at: savedAt }]]);
    const res = await PUT(putReq({ baseRevision: 4, state: DEFAULT_STATE }));
    expect(await res.json()).toEqual({ revision: 5, updatedAt: savedAt.toISOString() });
    expect(calls[0].text).toMatch(/revision = revision \+ 1/);
    expect(calls[0].text).toMatch(/where user_id = \$1 and revision = \$2/);
    expect(calls[0].params.slice(0, 2)).toEqual(["user_a", 4]);
  });

  it("stale baseRevision -> 0 rows -> 409 with the current row", async () => {
    asUser("user_a");
    const server = { ...DEFAULT_STATE, favorites: ["pollo"] };
    fakeSql([[], [{ revision: 7, state: server, updated_at: savedAt }]]);
    const res = await PUT(putReq({ baseRevision: 4, state: DEFAULT_STATE }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      revision: 7,
      state: server,
      updatedAt: savedAt.toISOString(),
    });
  });

  it("stale baseRevision and no row at all -> 409 revision 0, state null", async () => {
    asUser("user_a");
    fakeSql([[], []]);
    const res = await PUT(putReq({ baseRevision: 2, state: DEFAULT_STATE }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", revision: 0, state: null, updatedAt: null });
  });
});

describe("isolation between accounts", () => {
  it("every query carries only the caller's user_id", async () => {
    const { calls } = fakeSql([
      [],
      [{ revision: 1, updated_at: savedAt }],
      [],
      [{ revision: 3, updated_at: savedAt }],
    ]);

    asUser("user_a");
    await GET();
    await PUT(putReq(validBody));

    asUser("user_b");
    await GET();
    await PUT(putReq({ baseRevision: 2, state: DEFAULT_STATE }));
    expect(calls).toHaveLength(4);

    const forA = calls.slice(0, 2).map((c) => c.params[0]);
    const forB = calls.slice(2).map((c) => c.params[0]);
    expect(forA).toEqual(["user_a", "user_a"]);
    expect(forB).toEqual(["user_b", "user_b"]);
    for (const c of calls) {
      expect(c.params).not.toContain(c.params[0] === "user_a" ? "user_b" : "user_a");
    }
  });

  it("user_id ignores any userId sent in the body", async () => {
    asUser("user_a");
    const { calls } = fakeSql([[{ revision: 1, updated_at: savedAt }]]);
    await PUT(putReq({ ...validBody, userId: "user_b" }));
    expect(calls[0].params[0]).toBe("user_a");
    expect(calls[0].params).not.toContain("user_b");
  });
});
