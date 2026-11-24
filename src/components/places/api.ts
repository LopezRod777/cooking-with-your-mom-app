// Client side of /api/geocode and /api/places. Types are the client's view of the wire shapes.

import { isOfflineNow } from "../../lib/offline/useOffline";
import type { LivePrices } from "@/lib/prices";

export type PlaceType = "grocery" | "convenience" | "liquor" | "vet";

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

export type GeocodeOutcome =
  | { status: "ok"; lat: number; lng: number }
  | { status: "none" }
  | { status: "busy" }
  | { status: "error" };

export async function geocodeLocation(
  body: { zip: string } | { city: string; state: string },
): Promise<GeocodeOutcome> {
  if (isOfflineNow()) return { status: "error" };
  let res: Response;
  try {
    res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: "error" };
  }
  const json = (await res.json().catch(() => null)) as { status?: string; lat?: unknown; lng?: unknown } | null;
  if (json?.status === "ok" && typeof json.lat === "number" && typeof json.lng === "number") {
    return { status: "ok", lat: json.lat, lng: json.lng };
  }
  if (json?.status === "none") return { status: "none" };
  if (json?.status === "busy") return { status: "busy" };
  return { status: "error" };
}

export type Truncated = Record<PlaceType, boolean>;

export type PlacesStep =
  | { kind: "notready" }
  | { kind: "pending"; retryAfterS: number }
  | { kind: "done"; status: "ok" | "empty" | "unavailable"; places: Place[]; truncated: Truncated };

const NO_TRUNCATION: Truncated = { grocery: false, convenience: false, liquor: false, vet: false };

/** One GET of /api/places. Throws on network failure; the caller treats that as unavailable. */
export async function fetchPlacesStep(savedLocationId: string, radiusMiles?: number): Promise<PlacesStep> {
  const radius = radiusMiles === undefined ? "" : `&radius=${encodeURIComponent(String(radiusMiles))}`;
  const res = await fetch(`/api/places?loc=${encodeURIComponent(savedLocationId)}${radius}`, { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as
    | { status?: string; retryAfterS?: unknown; places?: unknown; truncated?: Partial<Record<PlaceType, unknown>> }
    | null;
  // The saved location may still be syncing (debounced PUT): retry briefly before giving up.
  if (res.status === 400 && (json as { error?: string } | null)?.error === "no_coords") {
    return { kind: "notready" };
  }
  if (res.status === 202) {
    const s = typeof json?.retryAfterS === "number" ? json.retryAfterS : 5;
    return { kind: "pending", retryAfterS: Math.min(Math.max(s, 1), 30) };
  }
  if (res.ok && (json?.status === "ok" || json?.status === "empty" || json?.status === "unavailable")) {
    return {
      kind: "done",
      status: json.status,
      places: Array.isArray(json.places) ? (json.places as Place[]) : [],
      truncated: {
        grocery: json.truncated?.grocery === true,
        convenience: json.truncated?.convenience === true,
        liquor: json.truncated?.liquor === true,
        vet: json.truncated?.vet === true,
      },
    };
  }
  return { kind: "done", status: "unavailable", places: [], truncated: NO_TRUNCATION };
}

/** Fire-and-forget warm-up after a save or a radius change. */
export function prefetchPlaces(savedLocationId: string): void {
  if (isOfflineNow()) return;
  fetch(`/api/places?loc=${encodeURIComponent(savedLocationId)}`, { cache: "no-store" }).catch(() => {});
}

// One GET of /api/prices for the saved location, the preferred store and the grocery keys.
// Network failure throws; the caller treats that as unavailable. Every ok/no_store carries the storeId the
// server priced for; without it the answer cannot be tied to a store, so it is treated as unavailable.
export type PricesOutcome =
  | ({ status: "ok"; storeId: string } & LivePrices)
  | { status: "no_store"; storeId: string; checked: boolean }
  | { status: "pending_sync"; retryAfterS: number }
  | { status: "not_configured" }
  | { status: "unavailable" };

export async function fetchLivePrices(savedLocationId: string, storeId: string, keys: string[]): Promise<PricesOutcome> {
  const query = `loc=${encodeURIComponent(savedLocationId)}&store=${encodeURIComponent(storeId)}&keys=${encodeURIComponent(keys.join(","))}`;
  const res = await fetch(`/api/prices?${query}`, { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as
    | { status?: string; storeId?: unknown; retryAfterS?: unknown; store?: { locationId?: unknown; name?: unknown }; quotedAt?: unknown; prices?: unknown; checked?: unknown }
    | null;
  if (json?.status === "pending_sync") {
    const s = typeof json.retryAfterS === "number" ? json.retryAfterS : 2;
    return { status: "pending_sync", retryAfterS: Math.min(Math.max(s, 1), 10) };
  }
  if (json?.status === "no_store" && typeof json.storeId === "string") {
    return { status: "no_store", storeId: json.storeId, checked: json.checked === true };
  }
  if (json?.status === "not_configured") return { status: "not_configured" };
  if (
    json?.status === "ok" &&
    typeof json.storeId === "string" &&
    typeof json.store?.locationId === "string" &&
    typeof json.store?.name === "string" &&
    typeof json.quotedAt === "string" &&
    json.prices &&
    typeof json.prices === "object"
  ) {
    const prices: LivePrices["prices"] = {};
    for (const [key, raw] of Object.entries(json.prices as Record<string, { regular?: unknown; promo?: unknown; size?: unknown }>)) {
      if (typeof raw?.regular !== "number" || !Number.isFinite(raw.regular) || raw.regular <= 0) continue;
      const promo = typeof raw.promo === "number" && Number.isFinite(raw.promo) && raw.promo > 0 ? raw.promo : undefined;
      prices[key] = { regular: raw.regular, size: typeof raw.size === "string" ? raw.size : "", ...(promo !== undefined ? { promo } : {}) };
    }
    return {
      status: "ok",
      storeId: json.storeId,
      store: { locationId: json.store.locationId, name: json.store.name },
      quotedAt: json.quotedAt,
      prices,
    };
  }
  return { status: "unavailable" };
}
