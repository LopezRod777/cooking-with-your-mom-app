import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../db", () => ({ getSql: vi.fn(() => ({ query })) }));

import { AI_DAILY_CAPS, AI_GLOBAL_DAILY_CAPS, SHARED_ONLY_DAILY_CAPS, reserveAiQuota, reserveSharedQuota } from "../ai/dailyQuota";

// La sentencia real hace el tope en SQL (WHERE n < cap). Aquí el mock responde como lo haría la base:
// una fila si el contador de ese (usuario, cubeta) subió, ninguna si ya estaba en su tope.
function fakeDb() {
  const counters = new Map<string, number>();
  query.mockImplementation(async (_sql: string, params: unknown[]) => {
    const [user, bucket, cap] = params as [string, string, number];
    const key = `${user}|${bucket}`;
    const n = counters.get(key) ?? 0;
    if (n >= cap) return [];
    counters.set(key, n + 1);
    return [{ n: n + 1 }];
  });
  return (user: string, bucket: string) => counters.get(`${user}|${bucket}`) ?? 0;
}

describe("AI_DAILY_CAPS", () => {
  it("matches the caps agreed per route", () => {
    expect(AI_DAILY_CAPS).toEqual({
      "ask-mom": 60,
      plan: 6,
      swap: 30,
      import: 20,
      "import-my-version": 20,
      "dish-image": 40,
      moderation: 40,
      "pet-photo": 30,
      "community-photo": 15,
      "community-write": 40,
    });
  });

  it("has a shared ceiling above each personal cap for every bucket", () => {
    for (const bucket of Object.keys(AI_DAILY_CAPS) as (keyof typeof AI_DAILY_CAPS)[]) {
      expect(AI_GLOBAL_DAILY_CAPS[bucket]).toBeGreaterThan(AI_DAILY_CAPS[bucket]);
    }
  });
});

describe("reserveAiQuota", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("allows exactly cap reservations per user and bucket, then refuses", async () => {
    const count = fakeDb();
    const results: boolean[] = [];
    for (let i = 0; i < AI_DAILY_CAPS.plan + 2; i++) results.push(await reserveAiQuota("user-a", "plan"));
    expect(results.slice(0, 6).every(Boolean)).toBe(true);
    expect(results.slice(6)).toEqual([false, false]);
    expect(count("user-a", "plan")).toBe(6);
  });

  it("a person past their own cap does not use up the shared ceiling", async () => {
    const count = fakeDb();
    for (let i = 0; i < AI_DAILY_CAPS.plan + 5; i++) await reserveAiQuota("user-a", "plan");
    expect(count("*", "plan")).toBe(AI_DAILY_CAPS.plan);
  });

  it("refuses everyone once the shared ceiling is reached", async () => {
    const count = fakeDb();
    let granted = 0;
    for (let u = 0; u < 60; u++) {
      for (let i = 0; i < AI_DAILY_CAPS.plan; i++) if (await reserveAiQuota(`user-${u}`, "plan")) granted++;
    }
    expect(granted).toBe(AI_GLOBAL_DAILY_CAPS.plan);
    expect(count("*", "plan")).toBe(AI_GLOBAL_DAILY_CAPS.plan);
  });

  it("passes the user, bucket and cap to the statement, personal first and shared second", async () => {
    fakeDb();
    await reserveAiQuota("user-b", "swap");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ai_daily_quota");
    expect(sql).toContain("ON CONFLICT (user_id, bucket, day)");
    expect(params).toEqual(["user-b", "swap", 30]);
    expect(query.mock.calls[1][1]).toEqual(["*", "swap", AI_GLOBAL_DAILY_CAPS.swap]);
  });

  it("uses the UTC day, not the server's local date", async () => {
    fakeDb();
    await reserveAiQuota("user-c", "dish-image");
    expect(query.mock.calls[0][0]).toContain("AT TIME ZONE 'UTC'");
  });

  it("returns false with no row back (cap already reached) and skips the shared ceiling", async () => {
    query.mockResolvedValueOnce([]);
    expect(await reserveAiQuota("user-d", "ask-mom")).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns true only when both the personal and the shared rows were bumped", async () => {
    query.mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([{ n: 1 }]);
    expect(await reserveAiQuota("user-e", "import")).toBe(true);
    query.mockResolvedValueOnce([{ n: 2 }]).mockResolvedValueOnce([]);
    expect(await reserveAiQuota("user-e", "import")).toBe(false);
  });
});

describe("reserveSharedQuota", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("takes count slots on the shared row, all or nothing, under the shared cap", async () => {
    query.mockResolvedValueOnce([{ n: 2 }]);
    expect(await reserveSharedQuota("step-image", 2)).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ai_daily_quota.n + $4 <= $3");
    expect(params).toEqual(["*", "step-image", SHARED_ONLY_DAILY_CAPS["step-image"], 2]);
    query.mockResolvedValueOnce([]);
    expect(await reserveSharedQuota("bottle-scan")).toBe(false);
    expect(query.mock.calls[1][1]).toEqual(["*", "bottle-scan", SHARED_ONLY_DAILY_CAPS["bottle-scan"], 1]);
  });
});
