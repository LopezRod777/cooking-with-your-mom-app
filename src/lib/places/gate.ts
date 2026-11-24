// Compuerta compartida en Neon para Nominatim y Overpass. Toda consulta usa una sola sentencia
// (sin transacciones interactivas) sobre el cliente HTTP de src/lib/db.ts.
import { getSql } from "../db";

export const MAX_WAIT_MS = 8000;
export const PENDING_ORPHAN_S_GEO = 60;

type Row = Record<string, unknown>;

export type Slot = { busy: false; slot: Date } | { busy: true; retryAfterS: number };

// Tablas que admiten reclamo de fila pendiente. Se validan porque el nombre va interpolado.
const CLAIMABLE = { geo_cache: true, places_cache: true } as const;
export type ClaimableTable = keyof typeof CLAIMABLE;

function assertTable(table: string): asserts table is ClaimableTable {
  if (!(table in CLAIMABLE)) throw new Error(`tabla no reclamable: ${table}`);
}

export function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

// Pure timing helpers (exported for tests).
export function nowPlus(ms: number, base: number = Date.now()): Date {
  return new Date(base + ms);
}

export async function sleepUntil(at: Date, now: () => number = Date.now): Promise<void> {
  const wait = Math.max(0, at.getTime() - now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// Reserva el siguiente hueco de `minGapMs` para `name`. Si el hueco cae a más de MAX_WAIT_MS,
// responde busy sin mover la compuerta (la condición del UPDATE lo impide).
export async function reserveSlot(name: string, minGapMs: number): Promise<Slot> {
  const sql = getSql();
  const rows = (await sql.query(
    `UPDATE rate_gate
        SET next_at = GREATEST(next_at, now()) + ($2::int * interval '1 millisecond')
      WHERE name = $1
        AND GREATEST(next_at, now()) <= now() + ($3::int * interval '1 millisecond')
      RETURNING next_at - ($2::int * interval '1 millisecond') AS slot`,
    [name, minGapMs, MAX_WAIT_MS],
  )) as Row[];
  if (rows[0]) return { busy: false, slot: toDate(rows[0].slot) };

  const wait = (await sql.query(
    `SELECT EXTRACT(EPOCH FROM (GREATEST(next_at, now()) - now())) AS secs FROM rate_gate WHERE name = $1`,
    [name],
  )) as Row[];
  const secs = wait[0] ? Number(wait[0].secs) : MAX_WAIT_MS / 1000;
  return { busy: true, retryAfterS: Math.max(1, Math.ceil(secs)) };
}

// Inserta una fila pendiente. true si esta petición es dueña; false si ya existe.
export async function claimPending(table: string, key: string, owner: string): Promise<boolean> {
  assertTable(table);
  const rows = (await getSql().query(
    `INSERT INTO ${table} (key, status, owner, created_at)
     VALUES ($1, 'pending', $2, now())
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [key, owner],
  )) as Row[];
  return rows.length === 1;
}

// Reclama una fila pendiente huérfana (creada hace más de `olderThanS`). Exclusivo: una sola gana.
export async function reclaimOrphan(table: string, key: string, owner: string, olderThanS: number): Promise<boolean> {
  assertTable(table);
  const rows = (await getSql().query(
    `UPDATE ${table}
        SET created_at = now(), owner = $2
      WHERE key = $1 AND status = 'pending'
        AND created_at < now() - ($3::int * interval '1 second')
      RETURNING key`,
    [key, owner, olderThanS],
  )) as Row[];
  return rows.length === 1;
}

// Borra la fila pendiente solo si es de este dueño (no toca filas ajenas).
export async function dropPending(table: string, key: string, owner: string): Promise<void> {
  assertTable(table);
  await getSql().query(`DELETE FROM ${table} WHERE key = $1 AND owner = $2 AND status = 'pending'`, [key, owner]);
}

// Arrendamiento global de una sola llamada en vuelo. Solo si no hay otro vigente ni backoff activo.
export async function acquireLease(name: string, owner: string, seconds: number): Promise<boolean> {
  const rows = (await getSql().query(
    `UPDATE rate_gate
        SET lease_until = now() + ($3::int * interval '1 second'), owner = $2
      WHERE name = $1
        AND (lease_until IS NULL OR lease_until < now())
        AND (next_at IS NULL OR next_at <= now())
      RETURNING name`,
    [name, owner, seconds],
  )) as Row[];
  return rows.length === 1;
}

// Renueva el arrendamiento solo a su dueño vigente. false = perdido: el dueño debe abortar.
export async function renewLease(name: string, owner: string, seconds: number): Promise<boolean> {
  const rows = (await getSql().query(
    `UPDATE rate_gate
        SET lease_until = now() + ($3::int * interval '1 second')
      WHERE name = $1 AND owner = $2 AND lease_until > now()
      RETURNING name`,
    [name, owner, seconds],
  )) as Row[];
  return rows.length === 1;
}

export async function releaseLease(name: string, owner: string): Promise<void> {
  await getSql().query(
    `UPDATE rate_gate SET lease_until = NULL, owner = NULL WHERE name = $1 AND owner = $2`,
    [name, owner],
  );
}

// Pausa global: nadie llama a ese endpoint hasta now() + seconds.
export async function setBackoff(name: string, seconds: number): Promise<void> {
  await getSql().query(
    `UPDATE rate_gate SET next_at = now() + ($2::int * interval '1 second') WHERE name = $1`,
    [name, seconds],
  );
}

export async function backoffActive(name: string): Promise<boolean> {
  const rows = (await getSql().query(
    `SELECT (next_at > now()) AS active FROM rate_gate WHERE name = $1`,
    [name],
  )) as Row[];
  return rows[0]?.active === true;
}

// Segundos que faltan para que termine el backoff (0 si no hay ninguno activo).
export async function backoffRemainingS(name: string): Promise<number> {
  const rows = (await getSql().query(
    `SELECT CEIL(EXTRACT(EPOCH FROM (next_at - now())))::int AS secs FROM rate_gate WHERE name = $1 AND next_at > now()`,
    [name],
  )) as Row[];
  return rows[0] ? Math.max(1, Number(rows[0].secs)) : 0;
}
