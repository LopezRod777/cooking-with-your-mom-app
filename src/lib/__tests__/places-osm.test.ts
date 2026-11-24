import { afterEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db";
import { haversineMi } from "../geo";
import { buildUnionQuery, fetchPlaces, normalize, OVERPASS_LEASE_RENEW_MS, PLACES_PER_TYPE } from "../places/osm";

vi.mock("../db", () => ({ getSql: vi.fn() }));

const origin = { lat: 42.3816, lng: -71.0989 };

const fixture = [
  {
    type: "node",
    id: 1001,
    lat: 42.3831,
    lon: -71.0995,
    tags: {
      shop: "supermarket",
      name: "Trader Joe's",
      brand: "Trader Joe's",
      "addr:housenumber": "145",
      "addr:street": "Middlesex Avenue",
      opening_hours: "Mo-Su 09:00-21:00",
      phone: "+1 617 555 0100",
    },
  },
  {
    type: "way",
    id: 2002,
    center: { lat: 42.3702, lon: -71.0511 },
    tags: { shop: "supermarket", name: "Star Market", brand: "Star Market" },
  },
  {
    type: "node",
    id: 3003,
    lat: 42.3822,
    lon: -71.0988,
    tags: { shop: "convenience", name: "Winter Hill Market" },
  },
  {
    type: "relation",
    id: 4004,
    center: { lat: 42.3950, lon: -71.1100 },
    tags: { shop: "wine", name: "Corner Wine & Spirits", "contact:phone": "+1 617 555 0199" },
  },
  {
    type: "node",
    id: 5005,
    lat: 42.3820,
    lon: -71.0990,
    tags: { amenity: "veterinary", "addr:street": "Broadway" },
  },
  {
    type: "node",
    id: 6006,
    lat: 42.3500,
    lon: -71.0700,
    tags: { amenity: "veterinary", name: "Cambridge Vet Clinic" },
  },
];

describe("buildUnionQuery", () => {
  const q = buildUnionQuery(42.382, -71.099, 4828);

  it("contains the four selectors in one union", () => {
    expect(q).toContain('nwr["shop"~"^(supermarket|greengrocer)$"]');
    expect(q).toContain('nwr["shop"="convenience"]');
    expect(q).toContain('nwr["shop"~"^(alcohol|wine)$"]');
    expect(q).toContain('nwr["amenity"="veterinary"]');
    expect(q.match(/nwr\[/g)).toHaveLength(4);
  });

  it("uses the radius in meters around the rounded point and the 90 s timeout", () => {
    expect(q).toContain("(around:4828,42.382,-71.099)");
    expect(q).toContain("[out:json][timeout:90];");
    expect(q).toContain("out center tags;");
  });
});

describe("normalize", () => {
  const places = normalize(fixture, origin).places;

  it("drops the element without a name and keeps five places", () => {
    expect(places).toHaveLength(5);
    expect(places.find((p) => p.id === "osm:vet/5005")).toBeUndefined();
  });

  it("maps types from tags and uses center for ways and relations", () => {
    const byId = Object.fromEntries(places.map((p) => [p.id, p]));
    expect(byId["osm:node/1001"].type).toBe("grocery");
    expect(byId["osm:way/2002"].type).toBe("grocery");
    expect(byId["osm:way/2002"].lat).toBe(42.3702);
    expect(byId["osm:node/3003"].type).toBe("convenience");
    expect(byId["osm:relation/4004"].type).toBe("liquor");
    expect(byId["osm:relation/4004"].lng).toBe(-71.11);
    expect(byId["osm:node/6006"].type).toBe("vet");
  });

  it("maps address, hours, phone and brand, leaving them out when absent", () => {
    const tj = places.find((p) => p.id === "osm:node/1001");
    expect(tj).toMatchObject({
      brand: "Trader Joe's",
      address: "145 Middlesex Avenue",
      openingHours: "Mo-Su 09:00-21:00",
      phone: "+1 617 555 0100",
    });
    const conv = places.find((p) => p.id === "osm:node/3003");
    expect(conv && "address" in conv).toBe(false);
    expect(conv && "brand" in conv).toBe(false);
    expect(places.find((p) => p.id === "osm:relation/4004")?.phone).toBe("+1 617 555 0199");
  });

  it("sorts by distance and rounds distanceMi to one decimal", () => {
    const dists = places.map((p) => p.distanceMi);
    expect([...dists].sort((a, b) => a - b)).toEqual(dists);
    const tj = places.find((p) => p.id === "osm:node/1001")!;
    const exact = haversineMi(origin, { lat: 42.3831, lng: -71.0995 });
    expect(tj.distanceMi).toBe(Math.round(exact * 10) / 10);
    expect(Number.isInteger(tj.distanceMi * 10)).toBe(true);
  });

  it(`caps each type at ${PLACES_PER_TYPE}`, () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      type: "node",
      id: 9000 + i,
      lat: 42.38 + i * 0.001,
      lon: -71.1,
      tags: { shop: "supermarket", name: `Market ${i}` },
    }));
    expect(normalize(many, origin).places).toHaveLength(PLACES_PER_TYPE);
  });

  it("flags truncated types only when more than the cap were found", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        type: "node",
        id: 9000 + i,
        lat: 42.38 + i * 0.001,
        lon: -71.1,
        tags: { shop: "supermarket", name: `Market ${i}` },
      }));
    const at25 = normalize(make(PLACES_PER_TYPE), origin);
    expect(at25.truncated).toEqual({ grocery: false, convenience: false, liquor: false, vet: false });
    const at26 = normalize(make(PLACES_PER_TYPE + 1), origin);
    expect(at26.truncated).toEqual({ grocery: true, convenience: false, liquor: false, vet: false });
    expect(at26.places).toHaveLength(PLACES_PER_TYPE);
  });

  it("dedupes same-type same-name places within 0.05 mi, keeping the closest", () => {
    const pair = [
      // Reliable Market como nodo, un poco más lejos del origen.
      { type: "way", id: 7002, center: { lat: 42.38325, lon: -71.09905 }, tags: { shop: "supermarket", name: "Reliable Market" } },
      // Mismo local como nodo, más cercano (misma tienda, ~10 m de distancia entre ambos).
      { type: "node", id: 7001, lat: 42.3832, lon: -71.099, tags: { shop: "supermarket", name: "reliable  market " } },
      // Mismo nombre pero lejos (> 0.05 mi): se conserva.
      { type: "node", id: 7003, lat: 42.4, lon: -71.1, tags: { shop: "supermarket", name: "Reliable Market" } },
      // Mismo nombre, distinto tipo: se conserva.
      { type: "node", id: 7004, lat: 42.3832, lon: -71.099, tags: { shop: "convenience", name: "Reliable Market" } },
    ];
    const { places } = normalize(pair, origin);
    const ids = places.map((p) => p.id).sort();
    expect(ids).toEqual(["osm:node/7001", "osm:node/7003", "osm:node/7004"]);
    expect(places.find((p) => p.id === "osm:node/7001")!.distanceMi).toBeLessThan(
      places.find((p) => p.id === "osm:node/7003")!.distanceMi,
    );
  });

  it("ignores malformed elements instead of throwing", () => {
    expect(normalize([null, 42, { type: "node" }], origin).places).toEqual([]);
  });
});

// Fake de places_cache y rate_gate con las sentencias de osm.ts y gate.ts (sin Postgres).
type Row = Record<string, unknown>;
const cacheRows = new Map<string, { status: string; owner: string | null }>();
const sqlTexts: string[] = [];
let renewOk = true;

function fakeQuery(text: string, params: unknown[] = []): Row[] {
  sqlTexts.push(text);
  if (text.startsWith("SELECT") && text.includes("FROM places_cache WHERE key")) {
    const r = cacheRows.get(params[0] as string);
    return r ? [{ status: r.status, json: null, fresh: false }] : [];
  }
  if (text.includes("AS active FROM rate_gate")) return [{ active: false }];
  if (text.startsWith("INSERT INTO places_cache")) {
    const [key, owner] = params as [string, string];
    if (cacheRows.has(key)) return [];
    cacheRows.set(key, { status: "pending", owner });
    return [{ key }];
  }
  if (text.includes("AND (lease_until IS NULL")) return [{ name: "overpass" }];
  if (text.includes("WHERE name = $1 AND owner = $2 AND lease_until > now()")) return renewOk ? [{ name: "overpass" }] : [];
  if (text.startsWith("DELETE FROM places_cache")) {
    const [key, owner] = params as [string, string];
    const r = cacheRows.get(key);
    if (r && r.owner === owner && r.status === "pending") cacheRows.delete(key);
    return [];
  }
  if (text.includes("SET lease_until = NULL")) return [];
  throw new Error(`fake: sentencia no soportada: ${text.slice(0, 70)}`);
}

describe("fetchPlaces: lease lost before the write", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drops the owner's pending row and answers unavailable/lease_lost, so pollers do not wait", async () => {
    cacheRows.clear();
    sqlTexts.length = 0;
    renewOk = false;
    vi.mocked(getSql).mockReturnValue({
      query: vi.fn(async (text: string, params: unknown[]) => fakeQuery(text, params)),
    } as unknown as ReturnType<typeof getSql>);

    let fetchStarted!: () => void;
    const started = new Promise<void>((r) => (fetchStarted = r));
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal!.addEventListener("abort", () => reject(new Error("aborted")));
          fetchStarted();
        }),
    );

    vi.useFakeTimers();
    const pending = fetchPlaces({ lat: origin.lat, lng: origin.lng, radiusMiles: 3 });
    await started;
    await vi.advanceTimersByTimeAsync(OVERPASS_LEASE_RENEW_MS);
    const out = await pending;

    expect(out).toMatchObject({ status: "unavailable", reason: "lease_lost", places: [] });
    expect(sqlTexts.some((t) => t.startsWith("DELETE FROM places_cache"))).toBe(true);
    expect(cacheRows.has("places:v1:42.382:-71.099:3")).toBe(false);
  });
});
