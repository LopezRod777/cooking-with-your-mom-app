export { DISTANCE_STEPS } from "./schemas";

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_MI = 3958.7613;
const METERS_PER_MILE = 1609.344;

// Distancia de círculo máximo en millas.
export function haversineMi(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Redondeo a 3 decimales (~110 m): coordenadas que salen del servidor y claves de caché.
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function milesToMeters(miles: number): number {
  return Math.round(miles * METERS_PER_MILE);
}
