// Tope diario por persona para las rutas que gastan IA (Anthropic / Gemini). Mismo patrón que reserveQuota
// (src/lib/pairings/db.ts): un contador por (usuario, cubeta, día UTC), subido en una sola sentencia; el bloqueo
// de fila hace exacto el tope bajo peticiones concurrentes. Cuenta intentos: no se devuelve un lugar si la llamada falla.
import { getSql } from "../db";

export const AI_DAILY_CAPS = {
  "ask-mom": 60,
  plan: 6,
  swap: 30,
  import: 20,
  "import-my-version": 20,
  "dish-image": 40,
  moderation: 40,
  // Not AI, but storage and abuse: same atomic counter instead of count-then-insert, which two requests can race.
  "pet-photo": 30,
  "community-photo": 15,
  "community-write": 40,
} as const;

// Ceiling for all accounts together, so signing up many accounts cannot multiply the bill.
export const AI_GLOBAL_DAILY_CAPS: Record<AiBucket, number> = {
  "ask-mom": 3000,
  plan: 300,
  swap: 1500,
  import: 400,
  "import-my-version": 400,
  "dish-image": 1500,
  moderation: 2000,
  "pet-photo": 3000,
  "community-photo": 1500,
  "community-write": 4000,
};

const GLOBAL_USER = "*";

export class AiQuotaError extends Error {
  constructor() {
    super("ai_quota");
  }
}

export type AiBucket = keyof typeof AI_DAILY_CAPS;

export const AI_QUOTA_MESSAGE = "Mama needs a break today. Try again tomorrow.";

type Row = Record<string, unknown>;

// true = se reservó un lugar; false = tope del día alcanzado (no se cuenta nada).
async function take(userId: string, bucket: AiBucket, cap: number): Promise<boolean> {
  const rows = (await getSql().query(
    `INSERT INTO ai_daily_quota (user_id, bucket, day, n) VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date, 1)
     ON CONFLICT (user_id, bucket, day) DO UPDATE SET n = ai_daily_quota.n + 1
       WHERE ai_daily_quota.n < $3
     RETURNING n`,
    [userId, bucket, cap],
  )) as Row[];
  return rows.length > 0;
}

// The personal slot is taken first, so someone past their own cap never eats the shared ceiling for everyone else;
// a refused shared slot leaves that person one slot down, which only affects them.
export async function reserveAiQuota(userId: string, bucket: AiBucket): Promise<boolean> {
  if (!(await take(userId, bucket, AI_DAILY_CAPS[bucket]))) return false;
  return take(GLOBAL_USER, bucket, AI_GLOBAL_DAILY_CAPS[bucket]);
}

// Shared ceilings for paths that keep their own per-person counter elsewhere (step photos, pairings, bottle scans).
// Call after the personal slot was granted. count > 1 takes several slots at once, all or nothing.
export const SHARED_ONLY_DAILY_CAPS = { "step-image": 3000, pairing: 1000, "bottle-scan": 500 } as const;
export type SharedOnlyBucket = keyof typeof SHARED_ONLY_DAILY_CAPS;

export async function reserveSharedQuota(bucket: SharedOnlyBucket, count = 1): Promise<boolean> {
  const rows = (await getSql().query(
    `INSERT INTO ai_daily_quota (user_id, bucket, day, n) VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date, $4)
     ON CONFLICT (user_id, bucket, day) DO UPDATE SET n = ai_daily_quota.n + $4
       WHERE ai_daily_quota.n + $4 <= $3
     RETURNING n`,
    [GLOBAL_USER, bucket, SHARED_ONLY_DAILY_CAPS[bucket], count],
  )) as Row[];
  return rows.length > 0;
}

export function quotaExceededResponse(): Response {
  return Response.json({ error: "quota", message: AI_QUOTA_MESSAGE }, { status: 429 });
}
