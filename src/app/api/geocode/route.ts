import { z } from "zod";
import { requireUser } from "../../../lib/auth/requireUser";
import { geocodeCity, geocodeZip } from "../../../lib/places/geocode";
import { censusZcta, dbZcta, nearestZcta } from "../../../lib/places/zcta";

export const maxDuration = 30;

const Body = z.union([
  z.object({ zip: z.string().regex(/^\d{5}$/) }),
  // Browser position → ZIP (Census ZCTA polygon, centroid table as fallback). The coordinates are not stored.
  z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  z.object({
    city: z.string().trim().min(2).max(60),
    state: z.string().regex(/^[A-Za-z]{2}$/),
  }),
  z.object({ ip: z.literal(true) }),
]);

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const body = parsed.data;
  if ("ip" in body) {
    // Connection-based location is city-level (an ISP in Cambridge resolves to downtown Boston), so it never
    // fills a ZIP. It only tells the person roughly where we think they are, and they type the ZIP.
    const rawCity = (req.headers.get("x-vercel-ip-city") ?? "").trim();
    let city = "";
    try { city = decodeURIComponent(rawCity); } catch { city = rawCity; }
    const region = (req.headers.get("x-vercel-ip-country-region") ?? "").trim().toUpperCase();
    const country = (req.headers.get("x-vercel-ip-country") ?? "").trim().toUpperCase();
    const ok = city.length > 0 && /^[A-Z]{2}$/.test(region) && (country === "" || country === "US");
    return Response.json(ok ? { status: "ok", city, region } : { status: "none" }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if ("lat" in body) {
    // Our ZCTA polygons in Neon first (nothing leaves the database), then the Census service, then the nearest
    // centroid flagged approx so the screen says "closest guess". Only timing and the source are logged, never the position.
    const started = Date.now();
    let exact: string | undefined;
    let source: "db" | "census" | "centroid" = "db";
    try {
      exact = await dbZcta(body.lat, body.lng);
    } catch (err) {
      console.warn("geocode: zcta table failed", err instanceof Error ? err.message : "error");
    }
    if (exact === undefined) {
      source = "census";
      try {
        exact = await censusZcta(body.lat, body.lng);
      } catch (err) {
        console.warn("geocode: census reverse failed", err instanceof Error ? err.message : "error");
      }
    }
    if (exact === undefined) source = "centroid";
    const zip = exact ?? nearestZcta(body.lat, body.lng);
    console.info(`geocode: position→zip via ${source} in ${Date.now() - started} ms`);
    return Response.json(zip ? { status: "ok", zip, label: `ZIP ${zip}`, approx: exact === undefined } : { status: "none" });
  }
  const result = "zip" in body ? await geocodeZip(body.zip) : await geocodeCity(body.city, body.state);
  return Response.json(result);
}
