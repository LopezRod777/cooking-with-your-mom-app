import zctaJson from "../../../data/zcta-centroids.json";
import { getSql } from "../db";

// Census 2020 ZCTA centroids, zip → [lat, lng]. No network, no database, so this module is safe on any server route.
const ZCTA = (zctaJson as unknown as { z: Record<string, [number, number]> }).z;

// Nearest ZIP centroid to a point, by great-circle distance. Undefined when the point is far from any US ZIP (> 60 mi),
// so a visitor abroad gets "type it in" instead of a coastal ZIP.
export function nearestZcta(lat: number, lng: number, maxMiles = 60): string | undefined {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(lat));
  let best: string | undefined;
  let bestD = Infinity;
  for (const zip in ZCTA) {
    const [zlat, zlng] = ZCTA[zip];
    // Equirectangular approximation: enough to rank neighbours, and 30× cheaper than haversine over 33k rows.
    const dx = toRad(zlng - lng) * cosLat;
    const dy = toRad(zlat - lat);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = zip;
    }
  }
  const miles = Math.sqrt(bestD) * 3958.8;
  return miles <= maxMiles ? best : undefined;
}

// Census Bureau geocoder: point → 2020 ZCTA polygon. Official, keyless, US only. Nominatim's reverse postcodes come
// from nearby OSM address tags and were wrong in East Cambridge (02214 for a 02142 point), so they are not used here.
export const CENSUS_GEO_URL = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
export const CENSUS_TIMEOUT_MS = 8000;

// Only the ZCTA layer counts, and only its ZCTA5 field: a GEOID from another layer (county, tract) is never a ZIP.
// Vintage stays Current_Current on purpose: it is the only vintage that serves the 2020 ZCTA layer (checked 2026-11-03;
// Census2020_Current returns every other layer and no ZCTA).
export const CENSUS_ZCTA_LAYER = "2020 Census ZIP Code Tabulation Areas";

export function parseCensusZcta(json: unknown): string | undefined {
  const geos = (json as { result?: { geographies?: Record<string, { ZCTA5?: unknown }[]> } } | null)?.result?.geographies;
  const rows = geos?.[CENSUS_ZCTA_LAYER];
  if (!Array.isArray(rows)) return undefined;
  for (const row of rows) {
    const code = row?.ZCTA5;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
  }
  return undefined;
}

export async function censusZcta(lat: number, lng: number): Promise<string | undefined> {
  const url = new URL(CENSUS_GEO_URL);
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("layers", CENSUS_ZCTA_LAYER);
  url.searchParams.set("format", "json");
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(CENSUS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`census HTTP ${res.status}`);
  return parseCensusZcta(await res.json());
}

// Our own copy of the Census ZCTA polygons in Neon (table `zcta`, loaded by scripts/data/load-zcta.sh). Nothing leaves
// the database on a hit. Undefined when the point is in no ZIP (water, abroad) or the table is still empty.
export async function dbZcta(lat: number, lng: number): Promise<string | undefined> {
  const rows = (await getSql().query(
    "SELECT zip FROM zcta WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) LIMIT 1",
    [lng, lat],
  )) as { zip: string }[];
  const zip = rows[0]?.zip;
  return typeof zip === "string" && /^\d{5}$/.test(zip) ? zip : undefined;
}
