// SQL del gate y de la persistencia de pairings. Sin imports de Next ni de Clerk: el script de
// pruebas contra Neon real carga este módulo tal cual.
import { randomBytes } from "node:crypto";
import { getSql } from "../db";

type Row = Record<string, unknown>;

export const DAILY_QUOTA = 20;
export const MAX_SAVED_PER_USER = 200;
const LEASE_SECONDS = 40;

export type UnlockRow = { session_id: string; nonce: string };

export async function createUnlock(userId: string, sessionId: string): Promise<string> {
  const nonce = randomBytes(32).toString("hex");
  await getSql().query(
    `INSERT INTO pairing_unlocks (user_id, session_id, nonce, created_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
       SET session_id = EXCLUDED.session_id, nonce = EXCLUDED.nonce, created_at = EXCLUDED.created_at`,
    [userId, sessionId, nonce],
  );
  return nonce;
}

export async function getUnlock(userId: string): Promise<UnlockRow | null> {
  const rows = (await getSql().query(
    "SELECT session_id, nonce FROM pairing_unlocks WHERE user_id = $1",
    [userId],
  )) as Row[];
  const row = rows[0];
  if (!row) return null;
  return { session_id: String(row.session_id), nonce: String(row.nonce) };
}

export async function deleteUnlock(userId: string): Promise<void> {
  await getSql().query("DELETE FROM pairing_unlocks WHERE user_id = $1", [userId]);
}

// Reserva una de las 20 llamadas del día. null = cuota agotada.
export async function reserveQuota(userId: string): Promise<number | null> {
  const rows = (await getSql().query(
    `INSERT INTO pairings_log (user_id, day, n) VALUES ($1, current_date, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET n = pairings_log.n + 1
       WHERE pairings_log.n < $2
     RETURNING n`,
    [userId, DAILY_QUOTA],
  )) as Row[];
  return rows[0] ? Number(rows[0].n) : null;
}

// Cuota diaria de escaneos de botella (docs/PLAN-BOTTLE.md, sección B). null = cuota agotada.
export const BOTTLE_DAILY_QUOTA = 10;
export async function reserveBottleQuota(userId: string): Promise<number | null> {
  const rows = (await getSql().query(
    `INSERT INTO bottle_scans (user_id, day, n) VALUES ($1, current_date, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET n = bottle_scans.n + 1
       WHERE bottle_scans.n < $2
     RETURNING n`,
    [userId, BOTTLE_DAILY_QUOTA],
  )) as Row[];
  return rows[0] ? Number(rows[0].n) : null;
}

// Reclama la única generación en vuelo del usuario. leaseSeconds solo lo usan las pruebas.
export async function claimInflight(
  userId: string,
  owner: string,
  leaseSeconds: number = LEASE_SECONDS,
): Promise<boolean> {
  const rows = (await getSql().query(
    `INSERT INTO pairing_inflight (user_id, owner, lease_until)
     VALUES ($1, $2, now() + ($3::int * interval '1 second'))
     ON CONFLICT (user_id) DO UPDATE
       SET owner = EXCLUDED.owner, lease_until = EXCLUDED.lease_until
       WHERE pairing_inflight.lease_until < now()
     RETURNING user_id`,
    [userId, owner, leaseSeconds],
  )) as Row[];
  return rows.length === 1;
}

export async function renewInflight(
  userId: string,
  owner: string,
  leaseSeconds: number = LEASE_SECONDS,
): Promise<boolean> {
  const rows = (await getSql().query(
    `UPDATE pairing_inflight
        SET lease_until = now() + ($3::int * interval '1 second')
      WHERE user_id = $1 AND owner = $2 AND lease_until > now()
      RETURNING user_id`,
    [userId, owner, leaseSeconds],
  )) as Row[];
  return rows.length === 1;
}

export async function releaseInflight(userId: string, owner: string): Promise<void> {
  await getSql().query("DELETE FROM pairing_inflight WHERE user_id = $1 AND owner = $2", [userId, owner]);
}

// Guardado + evicción en una transacción no interactiva. Ver docs/PLAN-PAIRINGS.md, sección B.
// El INSERT solo hace algo si el dueño sigue con lease válido; si no, devuelve 0 filas.
export async function savePairing(
  userId: string,
  recipeId: string,
  json: unknown,
  owner: string,
): Promise<"saved" | "lease_lost"> {
  const sql = getSql();
  const results = (await sql.transaction([
    sql.query("SELECT pg_advisory_xact_lock(hashtext('pairings:' || $1::text))", [userId]),
    sql.query(
      `INSERT INTO pairings (user_id, recipe_id, json, created_at)
       SELECT $1::text, $2::text, $3::jsonb, clock_timestamp()
        WHERE EXISTS (
          SELECT 1 FROM pairing_inflight
           WHERE user_id = $1::text AND owner = $4::text AND lease_until > clock_timestamp()
        )
       ON CONFLICT (user_id, recipe_id) DO UPDATE
         SET json = EXCLUDED.json, created_at = EXCLUDED.created_at
       RETURNING recipe_id`,
      [userId, recipeId, JSON.stringify(json), owner],
    ),
    sql.query(
      `DELETE FROM pairings
        WHERE user_id = $1 AND recipe_id IN (
          SELECT recipe_id FROM pairings WHERE user_id = $1
           ORDER BY created_at DESC, recipe_id OFFSET ${MAX_SAVED_PER_USER}
        )`,
      [userId],
    ),
  ])) as unknown[][];
  return (results[1] as Row[]).length === 1 ? "saved" : "lease_lost";
}

export async function getPairing(userId: string, recipeId: string): Promise<unknown | null> {
  const rows = (await getSql().query(
    "SELECT json FROM pairings WHERE user_id = $1 AND recipe_id = $2",
    [userId, recipeId],
  )) as Row[];
  return rows[0] ? rows[0].json : null;
}

export async function countPairings(userId: string): Promise<number> {
  const rows = (await getSql().query(
    "SELECT count(*)::int AS n FROM pairings WHERE user_id = $1",
    [userId],
  )) as Row[];
  return Number(rows[0].n);
}
