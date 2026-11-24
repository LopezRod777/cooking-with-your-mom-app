import { getSql } from "../db";
import type { WellnessDay } from "./parse";

export const RETENTION_DAYS = 90;
export const DEVICE_BRANDS = ["oura", "whoop", "withings", "apple_watch", "garmin", "fitbit", "samsung", "other"] as const;
export type DeviceBrand = (typeof DEVICE_BRANDS)[number];
export const DEVICE_LABELS: Record<DeviceBrand, string> = {
  oura: "Oura",
  whoop: "WHOOP",
  withings: "Withings",
  apple_watch: "Apple Watch",
  garmin: "Garmin",
  fitbit: "Fitbit",
  samsung: "Samsung",
  other: "Something else",
};
// Brands with an OAuth API usable from a web app (research 2026-11-03). The rest share an export file.
export const CONNECTABLE: DeviceBrand[] = ["oura", "whoop", "withings"];

export type WellnessSummary = {
  days: number;
  latestWeight: { kg: number; day: string } | null;
  sleep7: number | null; // mean hours over the last 7 recorded nights
  restingHr7: number | null;
  firstDay: string | null;
  lastDay: string | null;
};

// A missing table (migration not run yet) reads as "not set up" instead of a crash.
function notMigrated(err: unknown): boolean {
  return err instanceof Error && /relation .* does not exist/i.test(err.message);
}

export async function upsertDays(userId: string, days: WellnessDay[], source = "upload"): Promise<number> {
  const sql = getSql();
  let n = 0;
  for (const d of days) {
    await sql.query(
      `INSERT INTO wellness_daily (user_id, day, weight_kg, sleep_h, resting_hr, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id, day) DO UPDATE SET
         weight_kg = COALESCE(EXCLUDED.weight_kg, wellness_daily.weight_kg),
         sleep_h = COALESCE(EXCLUDED.sleep_h, wellness_daily.sleep_h),
         resting_hr = COALESCE(EXCLUDED.resting_hr, wellness_daily.resting_hr),
         source = EXCLUDED.source, updated_at = now()`,
      [userId, d.date, d.weightKg ?? null, d.sleepH ?? null, d.restingHr ?? null, source],
    );
    n++;
  }
  await sql.query(`DELETE FROM wellness_daily WHERE user_id = $1 AND day < current_date - $2::int`, [userId, RETENTION_DAYS]);
  return n;
}

export async function summary(userId: string): Promise<WellnessSummary | "not_migrated"> {
  try {
    const rows = (await getSql().query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, weight_kg::float AS weight_kg, sleep_h::float AS sleep_h, resting_hr
       FROM wellness_daily WHERE user_id = $1 ORDER BY day DESC LIMIT 90`,
      [userId],
    )) as { day: string; weight_kg: number | null; sleep_h: number | null; resting_hr: number | null }[];
    const w = rows.find((r) => r.weight_kg !== null);
    const sleeps = rows.filter((r) => r.sleep_h !== null).slice(0, 7).map((r) => r.sleep_h as number);
    const hrs = rows.filter((r) => r.resting_hr !== null).slice(0, 7).map((r) => r.resting_hr as number);
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    return {
      days: rows.length,
      latestWeight: w ? { kg: w.weight_kg as number, day: w.day } : null,
      sleep7: mean(sleeps),
      restingHr7: hrs.length ? Math.round(mean(hrs) as number) : null,
      firstDay: rows.length ? rows[rows.length - 1].day : null,
      lastDay: rows.length ? rows[0].day : null,
    };
  } catch (err) {
    if (notMigrated(err)) return "not_migrated";
    throw err;
  }
}

export async function clearWellness(userId: string): Promise<void> {
  await getSql().query(`DELETE FROM wellness_daily WHERE user_id = $1`, [userId]);
  await getSql().query(`DELETE FROM devices WHERE user_id = $1`, [userId]);
}

export async function getDevice(userId: string): Promise<{ brand: DeviceBrand; status: "chosen" | "connected" } | null | "not_migrated"> {
  try {
    const rows = (await getSql().query(`SELECT brand, status FROM devices WHERE user_id = $1`, [userId])) as { brand: DeviceBrand; status: "chosen" | "connected" }[];
    return rows[0] ?? null;
  } catch (err) {
    if (notMigrated(err)) return "not_migrated";
    throw err;
  }
}

export async function setDevice(userId: string, brand: DeviceBrand | null): Promise<void> {
  if (!brand) {
    await getSql().query(`DELETE FROM devices WHERE user_id = $1`, [userId]);
    return;
  }
  await getSql().query(
    `INSERT INTO devices (user_id, brand, status, updated_at) VALUES ($1, $2, 'chosen', now())
     ON CONFLICT (user_id) DO UPDATE SET brand = EXCLUDED.brand, status = 'chosen', updated_at = now()`,
    [userId, brand],
  );
}
