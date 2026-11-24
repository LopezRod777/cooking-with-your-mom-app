// Lugares cercanos desde Overpass (OpenStreetMap). Solo servidor.
// Constantes de tiempo y endpoints en un solo lugar: una medición posterior puede cambiarlas.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSql } from "../db";
import { haversineMi, milesToMeters, round3 } from "../geo";
import {
  acquireLease,
  backoffActive,
  claimPending,
  dropPending,
  reclaimOrphan,
  releaseLease,
  renewLease,
  setBackoff,
} from "./gate";

export const OVERPASS_PRIMARY = "https://overpass-api.de/api/interpreter";
export const OVERPASS_BACKUP = "https://overpass.private.coffee/api/interpreter";
export const OVERPASS_BUDGET_MS = 95_000;
export const OVERPASS_QUERY_TIMEOUT_S = 90;
export const OVERPASS_BACKUP_WINDOW_MS = 20_000;
export const OVERPASS_LEASE_S = 110;
export const OVERPASS_LEASE_RENEW_MS = 30_000;
export const OVERPASS_LEASE_RENEW_S = 60;
export const OVERPASS_BACKOFF_S = 30;
export const PLACES_PENDING_ORPHAN_S = 130;
export const PLACES_TTL_DAYS = 7;
export const PLACES_PER_TYPE = 25;
export const PLACES_RETRY_AFTER_S = 5;
export const DEDUPE_MILES = 0.05;
export const USER_AGENT = "cooking-with-your-mom/1.0 (hello@example.com)";

export const PLACE_TYPES = ["grocery", "convenience", "liquor", "vet"] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];
export type Truncated = Record<PlaceType, boolean>;

export type Place = {
  id: string;
  type: PlaceType;
  name: string;
  brand?: string;
  lat: number;
  lng: number;
  distanceMi: number;
  address?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
};

const noTruncation = (): Truncated => ({ grocery: false, convenience: false, liquor: false, vet: false });

export type PlacesOutcome =
  | { status: "ok" | "empty"; places: Place[]; fetchedAt: string; source: "osm"; truncated: Truncated }
  | { status: "unavailable"; places: []; fetchedAt: string; source: "osm"; reason: string; truncated: Truncated }
  | { status: "pending"; retryAfterS: number };

export function buildUnionQuery(lat: number, lng: number, radiusM: number): string {
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(3)},${lng.toFixed(3)})`;
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
(
  nwr["shop"~"^(supermarket|greengrocer)$"]${around};
  nwr["shop"="convenience"]${around};
  nwr["shop"~"^(alcohol|wine)$"]${around};
  nwr["amenity"="veterinary"]${around};
);
out center tags;`;
}

const OsmElement = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
export type OsmElement = z.infer<typeof OsmElement>;

function typeOf(tags: Record<string, string>): PlaceType | null {
  if (tags.shop === "supermarket" || tags.shop === "greengrocer") return "grocery";
  if (tags.shop === "convenience") return "convenience";
  if (tags.shop === "alcohol" || tags.shop === "wine") return "liquor";
  if (tags.amenity === "veterinary") return "vet";
  return null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

// Normaliza elementos de Overpass. Sin nombre o tipo conocido: se descartan. way/relation usan center.
// Dedupe: mismo tipo, mismo nombre normalizado y a menos de DEDUPE_MILES entre sí → se queda el más cercano.
// Tope: PLACES_PER_TYPE por tipo; `truncated` marca los tipos con más de ese número antes del tope.
export function normalize(
  elements: unknown[],
  origin: { lat: number; lng: number },
): { places: Place[]; truncated: Truncated } {
  const all: Array<{ place: Place; exact: number; key: string }> = [];
  for (const raw of elements) {
    const parsed = OsmElement.safeParse(raw);
    if (!parsed.success) continue;
    const el = parsed.data;
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) continue;
    const type = typeOf(tags);
    if (!type) continue;
    const point =
      el.lat !== undefined && el.lon !== undefined
        ? { lat: el.lat, lng: el.lon }
        : el.center
          ? { lat: el.center.lat, lng: el.center.lon }
          : null;
    if (!point) continue;

    const street = tags["addr:street"];
    const house = tags["addr:housenumber"];
    const exact = haversineMi(origin, point);
    const place: Place = {
      id: `osm:${el.type}/${el.id}`,
      type,
      name,
      lat: point.lat,
      lng: point.lng,
      distanceMi: round1(exact),
    };
    if (tags.brand) place.brand = tags.brand;
    if (street) place.address = house ? `${house} ${street}` : street;
    if (tags.opening_hours) place.openingHours = tags.opening_hours;
    const phone = tags.phone ?? tags["contact:phone"];
    if (phone) place.phone = phone;
    const site = (tags.website ?? tags["contact:website"] ?? "").trim();
    if (/^https?:\/\/\S+$/i.test(site)) place.website = site;
    all.push({ place, exact, key: nameKey(name) });
  }

  all.sort((a, b) => a.exact - b.exact);
  const kept: Array<{ place: Place; key: string }> = [];
  for (const item of all) {
    const dup = kept.some(
      (k) =>
        k.place.type === item.place.type &&
        k.key === item.key &&
        haversineMi({ lat: k.place.lat, lng: k.place.lng }, { lat: item.place.lat, lng: item.place.lng }) <
          DEDUPE_MILES,
    );
    if (!dup) kept.push({ place: item.place, key: item.key });
  }

  const counts: Record<PlaceType, number> = { grocery: 0, convenience: 0, liquor: 0, vet: 0 };
  for (const { place } of kept) counts[place.type]++;
  const truncated: Truncated = {
    grocery: counts.grocery > PLACES_PER_TYPE,
    convenience: counts.convenience > PLACES_PER_TYPE,
    liquor: counts.liquor > PLACES_PER_TYPE,
    vet: counts.vet > PLACES_PER_TYPE,
  };

  const perType: Record<PlaceType, number> = { grocery: 0, convenience: 0, liquor: 0, vet: 0 };
  const places: Place[] = [];
  for (const { place } of kept) {
    if (perType[place.type] >= PLACES_PER_TYPE) continue;
    perType[place.type]++;
    places.push(place);
  }
  return { places, truncated };
}

const OverpassBody = z.object({ elements: z.array(z.unknown()) });

type Attempt =
  | { kind: "ok"; elements: unknown[] }
  | { kind: "rate" }
  | { kind: "transient" }
  | { kind: "other" };

async function callOverpass(endpoint: string, query: string, signal: AbortSignal, timeoutMs: number): Promise<Attempt> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (res.status === 429 || res.status === 406) return { kind: "rate" };
    if (res.status >= 500) return { kind: "transient" };
    if (!res.ok) return { kind: "other" };
    const body = OverpassBody.safeParse(await res.json());
    if (!body.success) return { kind: "other" };
    return { kind: "ok", elements: body.data.elements };
  } catch {
    // Red, timeout o abort (arrendamiento perdido): se trata como transitorio.
    return { kind: "transient" };
  }
}

type CacheRow = { status: string; json: unknown; fresh: boolean };

async function readCache(key: string): Promise<CacheRow | undefined> {
  const rows = (await getSql().query(
    `SELECT status, json, created_at > now() - ($2::int * interval '1 day') AS fresh
       FROM places_cache WHERE key = $1`,
    [key, PLACES_TTL_DAYS],
  )) as CacheRow[];
  return rows[0];
}

type CachedData = { places: Place[]; fetchedAt: string; truncated: Truncated };

// Filas escritas antes de `truncated` no tienen la forma actual: se tratan como caché vencida.
function asCachedData(json: unknown): CachedData | undefined {
  const data = (typeof json === "string" ? JSON.parse(json) : json) as Partial<CachedData> | null;
  if (!data || !Array.isArray(data.places) || typeof data.fetchedAt !== "string" || !data.truncated) return undefined;
  return data as CachedData;
}

function unavailable(reason: string): PlacesOutcome {
  return {
    status: "unavailable",
    places: [],
    fetchedAt: new Date().toISOString(),
    source: "osm",
    reason,
    truncated: noTruncation(),
  };
}

export async function fetchPlaces(input: { lat: number; lng: number; radiusMiles: number }): Promise<PlacesOutcome> {
  const lat = round3(input.lat);
  const lng = round3(input.lng);
  const key = `places:v1:${lat.toFixed(3)}:${lng.toFixed(3)}:${input.radiusMiles}`;
  const sql = getSql();

  let row = await readCache(key);
  if (row && (row.status === "ok" || row.status === "empty")) {
    const data = row.fresh ? asCachedData(row.json) : undefined;
    if (data) {
      return { status: row.status, places: data.places, fetchedAt: data.fetchedAt, source: "osm", truncated: data.truncated };
    }
    await sql.query("DELETE FROM places_cache WHERE key = $1 AND status IN ('ok', 'empty')", [key]);
    row = undefined;
  }

  if (await backoffActive("overpass")) return unavailable("rate_limited");

  const owner = randomUUID();
  const mine = row
    ? await reclaimOrphan("places_cache", key, owner, PLACES_PENDING_ORPHAN_S)
    : await claimPending("places_cache", key, owner);
  if (!mine) return { status: "pending", retryAfterS: PLACES_RETRY_AFTER_S };

  if (!(await acquireLease("overpass", owner, OVERPASS_LEASE_S))) {
    await dropPending("places_cache", key, owner);
    if (await backoffActive("overpass")) return unavailable("rate_limited");
    return { status: "pending", retryAfterS: PLACES_RETRY_AFTER_S };
  }

  const controller = new AbortController();
  let leaseLost = false;
  const timer = setInterval(() => {
    renewLease("overpass", owner, OVERPASS_LEASE_RENEW_S)
      .then((ok) => {
        if (!ok) {
          leaseLost = true;
          controller.abort();
        }
      })
      .catch(() => {
        leaseLost = true;
        controller.abort();
      });
  }, OVERPASS_LEASE_RENEW_MS);

  try {
    const query = buildUnionQuery(lat, lng, milesToMeters(input.radiusMiles));
    const started = Date.now();
    let attempt = await callOverpass(OVERPASS_PRIMARY, query, controller.signal, OVERPASS_BUDGET_MS);
    if (attempt.kind === "transient" && !leaseLost && Date.now() - started < OVERPASS_BACKUP_WINDOW_MS) {
      const remaining = OVERPASS_BUDGET_MS - (Date.now() - started);
      attempt = await callOverpass(OVERPASS_BACKUP, query, controller.signal, remaining);
    }

    if (leaseLost) {
      await dropPending("places_cache", key, owner);
      return unavailable("lease_lost");
    }
    if (attempt.kind === "rate") {
      await setBackoff("overpass", OVERPASS_BACKOFF_S);
      await dropPending("places_cache", key, owner);
      return unavailable("rate_limited");
    }
    if (attempt.kind !== "ok") {
      await dropPending("places_cache", key, owner);
      return unavailable(attempt.kind === "transient" ? "upstream_unavailable" : "upstream_error");
    }

    const { places, truncated } = normalize(attempt.elements, { lat, lng });
    const status = places.length > 0 ? "ok" : "empty";
    const fetchedAt = new Date().toISOString();
    const written = await sql.query(
      `UPDATE places_cache
          SET status = $3, json = $4, created_at = now(), owner = NULL
        WHERE key = $1 AND owner = $2 AND status = 'pending'
          AND EXISTS (SELECT 1 FROM rate_gate WHERE name = 'overpass' AND owner = $2 AND lease_until > now())
        RETURNING key`,
      [key, owner, status, JSON.stringify({ places, fetchedAt, truncated })],
    );
    if (!Array.isArray(written) || written.length !== 1) {
      await dropPending("places_cache", key, owner);
      return unavailable("lease_lost");
    }
    return { status, places, fetchedAt, source: "osm", truncated };
  } finally {
    clearInterval(timer);
    await releaseLease("overpass", owner);
  }
}
