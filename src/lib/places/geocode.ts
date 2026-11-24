// ZIP y ciudad a coordenadas. Solo servidor (importa el JSON de centroides y usa la base).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSql } from "../db";
import zctaJson from "../../../data/zcta-centroids.json";
import {
  PENDING_ORPHAN_S_GEO,
  backoffRemainingS,
  claimPending,
  dropPending,
  reclaimOrphan,
  reserveSlot,
  setBackoff,
  sleepUntil,
  MAX_WAIT_MS,
} from "./gate";

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_GAP_MS = 1100;
export const NOMINATIM_TIMEOUT_MS = 8000;
export const USER_AGENT = "cooking-with-your-mom/1.0 (hello@example.com)";
const POLL_MS = 500;
const RETRY_AFTER_POLL_S = 5;
const RETRY_AFTER_UPSTREAM_S = 30;
// Pausa global de Nominatim tras 429 o 503: ninguna búsqueda sin caché llama durante estos segundos.
export const NOMINATIM_BACKOFF_S = 30;

export type GeoResult =
  | { status: "ok"; lat: number; lng: number; label: string }
  | { status: "none" }
  | { status: "busy"; retryAfterS: number };

type Found = { status: "ok"; lat: number; lng: number; label: string } | { status: "none" };

const ZCTA = (zctaJson as unknown as { z: Record<string, [number, number]> }).z;

const NominatimRows = z.array(z.object({ lat: z.string(), lon: z.string(), display_name: z.string() }));

class NominatimHttpError extends Error {
  constructor(readonly status: number) {
    super(`nominatim HTTP ${status}`);
  }
}

async function nominatim(params: Record<string, string>): Promise<Found> {
  const url = new URL(NOMINATIM_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
  });
  if (!res.ok) throw new NominatimHttpError(res.status);
  const rows = NominatimRows.parse(await res.json());
  const first = rows[0];
  if (!first) return { status: "none" };
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: "none" };
  return { status: "ok", lat, lng, label: first.display_name };
}

type CachedRow = { status: string; lat: number | null; lng: number | null; label: string | null };

async function readRow(key: string): Promise<CachedRow | undefined> {
  const rows = (await getSql().query(
    "SELECT status, lat, lng, label FROM geo_cache WHERE key = $1",
    [key],
  )) as CachedRow[];
  return rows[0];
}

// Resuelve una clave con caché y compuerta. Una sola petición llama a Nominatim; las demás esperan su fila.
async function cachedNominatim(key: string, params: Record<string, string>): Promise<GeoResult> {
  const table = "geo_cache" as const;
  const owner = randomUUID();
  const deadline = Date.now() + MAX_WAIT_MS;

  for (;;) {
    const row = await readRow(key);
    if (row?.status === "ok" && row.lat !== null && row.lng !== null) {
      return { status: "ok", lat: row.lat, lng: row.lng, label: row.label ?? "" };
    }
    if (row?.status === "none") return { status: "none" };

    // Con pausa activa no se reclama fila ni se llama: se responde busy con lo que falta.
    const pause = await backoffRemainingS("nominatim");
    if (pause > 0) return { status: "busy", retryAfterS: pause };

    const mine = row
      ? await reclaimOrphan(table, key, owner, PENDING_ORPHAN_S_GEO)
      : await claimPending(table, key, owner);
    if (mine) break;

    if (Date.now() >= deadline) return { status: "busy", retryAfterS: RETRY_AFTER_POLL_S };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  const slot = await reserveSlot("nominatim", NOMINATIM_GAP_MS);
  if (slot.busy) {
    await dropPending(table, key, owner);
    return { status: "busy", retryAfterS: slot.retryAfterS };
  }
  await sleepUntil(slot.slot);

  let found: Found;
  try {
    found = await nominatim(params);
  } catch (err) {
    // Error de red o HTTP: no se guarda como "none"; se libera la fila para reintentar.
    await dropPending(table, key, owner);
    if (err instanceof NominatimHttpError && (err.status === 429 || err.status === 503)) {
      await setBackoff("nominatim", NOMINATIM_BACKOFF_S);
    }
    return { status: "busy", retryAfterS: RETRY_AFTER_UPSTREAM_S };
  }

  if (found.status === "ok") {
    await getSql().query(
      "UPDATE geo_cache SET status = 'ok', lat = $3, lng = $4, label = $5 WHERE key = $1 AND owner = $2 AND status = 'pending'",
      [key, owner, found.lat, found.lng, found.label],
    );
  } else {
    await getSql().query(
      "UPDATE geo_cache SET status = 'none' WHERE key = $1 AND owner = $2 AND status = 'pending'",
      [key, owner],
    );
  }
  return found;
}

// Tabla local de centroides ZCTA (Census 2020). Sin red.
export function zctaLookup(zip: string): GeoResult | undefined {
  const hit = ZCTA[zip];
  return hit ? { status: "ok", lat: hit[0], lng: hit[1], label: `ZIP ${zip}` } : undefined;
}

// Nominatim primero (cacheado en geo_cache); la tabla ZCTA solo si Nominatim no resuelve (none, busy o error).
export async function geocodeZip(zip: string): Promise<GeoResult> {
  const viaNominatim = await cachedNominatim(`geo:zip:${zip}`, { postalcode: zip, country: "US" });
  if (viaNominatim.status === "ok") return { ...viaNominatim, label: `ZIP ${zip}` };
  return zctaLookup(zip) ?? viaNominatim;
}

export async function geocodeCity(city: string, state: string): Promise<GeoResult> {
  const name = city.trim();
  const st = state.trim().toUpperCase();
  const key = `geo:city:${name.toLowerCase()}|${st}`;
  return cachedNominatim(key, { q: `${name}, ${st}, USA` });
}
