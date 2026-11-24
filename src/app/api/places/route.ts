import { getSql } from "../../../lib/db";
import { DISTANCE_STEPS } from "../../../lib/geo";
import { requireUser } from "../../../lib/auth/requireUser";
import { fetchPlaces, PLACES_RETRY_AFTER_S } from "../../../lib/places/osm";

export const maxDuration = 120;

type Coords = { lat: number; lng: number; radiusMiles: number };

// Busca la ubicación guardada por id en app_state.state.places.saved. "legacy" usa state.location
// solo si trae lat/lng (el esquema actual no los tiene, así que hoy responde no_coords).
function pickLocation(state: unknown, loc: string, radiusOverride: number | null): Coords | { error: "no_coords" | "no_radius" } {
  const s = (state ?? {}) as { places?: { saved?: unknown }; location?: unknown };
  let entry: unknown;
  if (loc === "legacy") {
    entry = s.location;
  } else {
    const saved = Array.isArray(s.places?.saved) ? (s.places?.saved as Array<{ id?: unknown }>) : [];
    entry = saved.find((e) => e.id === loc);
  }
  const e = (entry ?? {}) as { lat?: unknown; lng?: unknown; radiusMiles?: unknown };
  if (typeof e.lat !== "number" || typeof e.lng !== "number" || !Number.isFinite(e.lat) || !Number.isFinite(e.lng)) {
    return { error: "no_coords" };
  }
  // A place saved as "Whole city" has no radius; a caller may name one for a nearby-stores lookup.
  const radiusMiles = typeof e.radiusMiles === "number" ? e.radiusMiles : radiusOverride;
  if (typeof radiusMiles !== "number" || !(DISTANCE_STEPS as readonly number[]).includes(radiusMiles)) {
    return { error: "no_radius" };
  }
  return { lat: e.lat, lng: e.lng, radiusMiles };
}

export async function GET(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  const params = new URL(req.url).searchParams;
  const loc = params.get("loc") ?? "";
  if (loc.length < 1 || loc.length > 40) return Response.json({ error: "no_coords" }, { status: 400 });
  const radiusParam = params.get("radius");
  const radiusOverride = radiusParam === null ? null : Number(radiusParam);

  const rows = (await getSql().query("select state from app_state where user_id = $1", [u.userId])) as Array<{
    state: unknown;
  }>;
  const picked = pickLocation(rows[0]?.state, loc, radiusOverride);
  if ("error" in picked) return Response.json({ error: picked.error }, { status: 400 });

  const out = await fetchPlaces(picked);
  if (out.status === "pending") {
    return Response.json({ status: "pending", retryAfterS: PLACES_RETRY_AFTER_S }, { status: 202 });
  }
  return Response.json(out);
}
