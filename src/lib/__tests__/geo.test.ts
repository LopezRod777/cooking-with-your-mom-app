import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db";
import { DISTANCE_STEPS, haversineMi, milesToMeters, round3 } from "../geo";
import { DISTANCE_STEPS as SCHEMA_STEPS } from "../schemas";
import { geocodeCity, geocodeZip, zctaLookup } from "../places/geocode";

vi.mock("../db", () => ({ getSql: vi.fn() }));

describe("haversineMi", () => {
  it("Boston (Downtown Crossing) to Cambridge (Harvard Square) is about 3.1 mi", () => {
    const d = haversineMi({ lat: 42.3555, lng: -71.0603 }, { lat: 42.3734, lng: -71.119 });
    expect(d).toBeGreaterThan(3.1 - 0.3);
    expect(d).toBeLessThan(3.1 + 0.3);
  });

  it("is zero for the same point", () => {
    expect(haversineMi({ lat: 42, lng: -71 }, { lat: 42, lng: -71 })).toBe(0);
  });
});

describe("helpers", () => {
  it("round3 keeps three decimals", () => {
    expect(round3(42.38159)).toBe(42.382);
    expect(round3(-71.0988592)).toBe(-71.099);
  });

  it("milesToMeters converts with 1609.344 m per mile", () => {
    expect(milesToMeters(3)).toBe(4828);
    expect(milesToMeters(0.5)).toBe(805);
  });

  it("re-exports the schema distance steps", () => {
    expect(DISTANCE_STEPS).toBe(SCHEMA_STEPS);
    expect([...DISTANCE_STEPS]).toEqual([0.5, 1, 2, 3, 5, 7.5, 10]);
  });
});

describe("ZCTA table", () => {
  it("has 02143 and 80302 and returns undefined for unknown ZIPs", () => {
    expect(zctaLookup("02143")).toEqual({ status: "ok", lat: 42.3814, lng: -71.0967, label: "ZIP 02143" });
    // OJO: el centroide ZCTA de 80302 queda a ~5.3 mi del punto de Nominatim (ver docs/PLAN-TIENDAS.md, B1).
    expect(zctaLookup("80302")).toEqual({ status: "ok", lat: 40.0434, lng: -105.3724, label: "ZIP 80302" });
    expect(zctaLookup("99999")).toBeUndefined();
  });
});

// Fake de geo_cache y rate_gate con las sentencias exactas de geocode.ts y gate.ts.
type Row = Record<string, unknown>;
const geo = new Map<string, Row>();
let nextAt: number | null = null;

function fakeQuery(text: string, params: unknown[] = []): Row[] {
  if (text.startsWith("SELECT status, lat, lng, label FROM geo_cache")) {
    const r = geo.get(params[0] as string);
    return r ? [r] : [];
  }
  if (text.startsWith("INSERT INTO geo_cache")) {
    const [key, owner] = params as [string, string];
    if (geo.has(key)) return [];
    geo.set(key, { key, status: "pending", owner, lat: null, lng: null, label: null, created_at: Date.now() });
    return [{ key }];
  }
  if (text.includes("UPDATE rate_gate") && text.includes("next_at = GREATEST")) {
    const [, gap, maxWait] = params as [string, number, number];
    const cur = Math.max(nextAt ?? Date.now(), Date.now());
    if (cur > Date.now() + maxWait) return [];
    nextAt = cur + gap;
    return [{ slot: new Date(cur) }];
  }
  if (text.startsWith("UPDATE geo_cache SET status = 'ok'")) {
    const [key, owner, lat, lng, label] = params as [string, string, number, number, string];
    const r = geo.get(key);
    if (!r || r.owner !== owner || r.status !== "pending") return [];
    Object.assign(r, { status: "ok", lat, lng, label });
    return [{ key }];
  }
  if (text.startsWith("UPDATE geo_cache SET status = 'none'")) {
    const [key, owner] = params as [string, string];
    const r = geo.get(key);
    if (r && r.owner === owner && r.status === "pending") r.status = "none";
    return [];
  }
  if (text.startsWith("DELETE FROM geo_cache")) {
    const [key, owner] = params as [string, string];
    const r = geo.get(key);
    if (r && r.owner === owner && r.status === "pending") geo.delete(key);
    return [];
  }
  if (text.startsWith("UPDATE rate_gate SET next_at = now()")) {
    nextAt = Date.now() + (params[1] as number) * 1000;
    return [];
  }
  if (text.includes("AS secs FROM rate_gate")) {
    return nextAt !== null && nextAt > Date.now() ? [{ secs: Math.ceil((nextAt - Date.now()) / 1000) }] : [];
  }
  throw new Error(`fake: sentencia no soportada: ${text.slice(0, 70)}`);
}

const nominatimRow = [{ lat: "42.3815895", lon: "-71.0988592", display_name: "02143, Somerville, Massachusetts, United States" }];

function fetchReturns(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    status === 200 ? Response.json(body) : new Response("boom", { status }),
  );
}

beforeEach(() => {
  geo.clear();
  nextAt = null;
  vi.restoreAllMocks();
  vi.mocked(getSql).mockReturnValue({
    query: vi.fn(async (text: string, params: unknown[]) => fakeQuery(text, params)),
  } as unknown as ReturnType<typeof getSql>);
});

describe("geocodeZip: Nominatim first, ZCTA table as fallback", () => {
  it("asks Nominatim with postalcode, country and the identifying User-Agent, and labels it ZIP", async () => {
    const fetchSpy = fetchReturns(nominatimRow);
    const r = await geocodeZip("02143");
    expect(r).toEqual({ status: "ok", lat: 42.3815895, lng: -71.0988592, label: "ZIP 02143" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("postalcode=02143");
    expect(String(url)).toContain("country=US");
    expect(String(url)).toContain("format=jsonv2");
    expect(String(url)).toContain("limit=1");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("cooking-with-your-mom/1.0 (hello@example.com)");
  });

  it("serves the second lookup from geo_cache without calling Nominatim", async () => {
    const fetchSpy = fetchReturns(nominatimRow);
    await geocodeZip("02143");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockClear();
    const r = await geocodeZip("02143");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: "ok", lat: 42.3815895, label: "ZIP 02143" });
  });

  it("falls back to the table when Nominatim has no result", async () => {
    fetchReturns([]);
    expect(await geocodeZip("02143")).toEqual({ status: "ok", lat: 42.3814, lng: -71.0967, label: "ZIP 02143" });
  });

  it("falls back to the table when Nominatim fails, and does not cache the failure as none", async () => {
    fetchReturns(null, 500);
    expect(await geocodeZip("80302")).toEqual({ status: "ok", lat: 40.0434, lng: -105.3724, label: "ZIP 80302" });
    expect(geo.has("geo:zip:80302")).toBe(false);
  });

  it("returns none for a ZIP that is neither in Nominatim nor in the table", async () => {
    fetchReturns([]);
    expect(await geocodeZip("00001")).toEqual({ status: "none" });
    expect(geo.get("geo:zip:00001")?.status).toBe("none");
  });
});

describe("Nominatim 429: global pause", () => {
  it("first 429 returns busy and pauses Nominatim; the next uncached lookup returns busy without fetching", async () => {
    const fetchSpy = fetchReturns(null, 429);
    expect(await geocodeCity("Boulder", "CO")).toEqual({ status: "busy", retryAfterS: 30 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(geo.has("geo:city:boulder|CO")).toBe(false);

    fetchSpy.mockClear();
    const second = await geocodeCity("Cambridge", "MA");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(second.status).toBe("busy");
    expect((second as { retryAfterS: number }).retryAfterS).toBeGreaterThan(25);
    expect((second as { retryAfterS: number }).retryAfterS).toBeLessThanOrEqual(30);
  });

  it("a ZIP outside the table is also busy during the pause, without fetching", async () => {
    const fetchSpy = fetchReturns(null, 429);
    await geocodeZip("00001");
    fetchSpy.mockClear();
    expect(await geocodeZip("00001")).toMatchObject({ status: "busy" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
