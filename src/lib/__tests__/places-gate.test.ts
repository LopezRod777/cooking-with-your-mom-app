// Prueba la lógica de compuerta contra un fake en memoria que implementa exactamente las
// sentencias de src/lib/places/gate.ts. No prueba Postgres: prueba decisiones y argumentos.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db";
import {
  claimPending,
  dropPending,
  reclaimOrphan,
  reserveSlot,
  sleepUntil,
  MAX_WAIT_MS,
} from "../places/gate";

vi.mock("../db", () => ({ getSql: vi.fn() }));

type Row = Record<string, unknown>;
type Call = { text: string; params: unknown[] };

let now = 0; // reloj del fake, en ms
const gate = new Map<string, { next_at: number | null }>();
const geo = new Map<string, { key: string; status: string; owner: string | null; created_at: number }>();
const calls: Call[] = [];

function fakeQuery(text: string, params: unknown[] = []): Row[] {
  calls.push({ text, params });

  if (text.includes("UPDATE rate_gate") && text.includes("next_at = GREATEST")) {
    const [name, gap, maxWait] = params as [string, number, number];
    const row = gate.get(name)!;
    const cur = Math.max(row.next_at ?? now, now);
    if (cur > now + maxWait) return [];
    row.next_at = cur + gap;
    return [{ slot: new Date(cur) }];
  }
  if (text.includes("SELECT EXTRACT(EPOCH")) {
    const row = gate.get(params[0] as string)!;
    return [{ secs: Math.max((row.next_at ?? now) - now, now - now) / 1000 }];
  }
  if (text.startsWith("INSERT INTO")) {
    const table = /INSERT INTO (\w+)/.exec(text)![1];
    expect(table).toBe("geo_cache");
    const [key, owner] = params as [string, string];
    if (geo.has(key)) return [];
    geo.set(key, { key, status: "pending", owner, created_at: now });
    return [{ key }];
  }
  if (text.startsWith("UPDATE geo_cache") && text.includes("created_at < now()")) {
    const [key, owner, olderThanS] = params as [string, string, number];
    const row = geo.get(key);
    if (!row || row.status !== "pending" || !(row.created_at < now - olderThanS * 1000)) return [];
    row.owner = owner;
    row.created_at = now;
    return [{ key }];
  }
  if (text.startsWith("DELETE FROM geo_cache")) {
    const [key, owner] = params as [string, string];
    const row = geo.get(key);
    if (row && row.owner === owner && row.status === "pending") geo.delete(key);
    return [];
  }
  throw new Error(`fake: sentencia no soportada: ${text.slice(0, 60)}`);
}

beforeEach(() => {
  now = 1_000_000;
  gate.clear();
  geo.clear();
  calls.length = 0;
  gate.set("nominatim", { next_at: null });
  gate.set("overpass", { next_at: null });
  vi.mocked(getSql).mockReturnValue({
    query: vi.fn(async (text: string, params: unknown[]) => fakeQuery(text, params)),
  } as unknown as ReturnType<typeof getSql>);
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

describe("reserveSlot", () => {
  it("sends one UPDATE ... RETURNING with name, gap and max wait as arguments", async () => {
    await reserveSlot("nominatim", 1100);
    const upd = calls.find((c) => c.text.startsWith("UPDATE rate_gate"))!;
    expect(upd.text).toContain("GREATEST(next_at, now())");
    expect(upd.text).toContain("RETURNING next_at - ($2::int * interval '1 millisecond') AS slot");
    expect(upd.params).toEqual(["nominatim", 1100, MAX_WAIT_MS]);
  });

  it("two reservations in a row are at least 1100 ms apart", async () => {
    const a = await reserveSlot("nominatim", 1100);
    const b = await reserveSlot("nominatim", 1100);
    expect(a.busy).toBe(false);
    expect(b.busy).toBe(false);
    if (!a.busy && !b.busy) expect(b.slot.getTime() - a.slot.getTime()).toBe(1100);
  });

  it("returns busy without moving the gate when the slot is more than 8 s away", async () => {
    gate.get("nominatim")!.next_at = now + 20_000;
    const r = await reserveSlot("nominatim", 1100);
    expect(r).toEqual({ busy: true, retryAfterS: 20 });
    expect(gate.get("nominatim")!.next_at).toBe(now + 20_000);
  });

  it("starts at now when the gate is idle", async () => {
    const r = await reserveSlot("nominatim", 1100);
    if (r.busy) throw new Error("no debería estar ocupado");
    expect(r.slot.getTime()).toBe(now);
  });
});

describe("pending row flow (geo_cache)", () => {
  it("first claim wins, second claim loses", async () => {
    expect(await claimPending("geo_cache", "geo:zip:99999", "A")).toBe(true);
    expect(await claimPending("geo_cache", "geo:zip:99999", "B")).toBe(false);
  });

  it("a fresh pending row is not reclaimed, an orphan (older than 60 s) is, once", async () => {
    await claimPending("geo_cache", "k", "A");
    now += 30_000;
    expect(await reclaimOrphan("geo_cache", "k", "B", 60)).toBe(false);
    now += 31_000;
    expect(await reclaimOrphan("geo_cache", "k", "B", 60)).toBe(true);
    expect(geo.get("k")!.owner).toBe("B");
    expect(await reclaimOrphan("geo_cache", "k", "C", 60)).toBe(false);
  });

  it("dropPending deletes only the owner's pending row", async () => {
    await claimPending("geo_cache", "k", "A");
    await dropPending("geo_cache", "k", "B");
    expect(geo.has("k")).toBe(true);
    await dropPending("geo_cache", "k", "A");
    expect(geo.has("k")).toBe(false);
  });

  it("rejects table names outside the allowlist", async () => {
    await expect(claimPending("app_state", "k", "A")).rejects.toThrow(/no reclamable/);
  });
});

describe("sleepUntil", () => {
  it("resolves at once when the time is already past", async () => {
    await expect(sleepUntil(new Date(now - 5), () => now)).resolves.toBeUndefined();
  });
});
