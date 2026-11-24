// Contador diario compartido de llamadas a Kroger /v1/products. Solo servidor.
// Cada llamada se reserva antes de salir; null = tope del día alcanzado (o fila no creada).
import { getSql } from "../db";

export const KROGER_DAILY_CAP = 6000;

type Row = Record<string, unknown>;

export async function reserveKrogerCall(): Promise<number | null> {
  const rows = (await getSql().query(
    `INSERT INTO kroger_calls (day, n) VALUES (current_date, 1)
     ON CONFLICT (day) DO UPDATE SET n = kroger_calls.n + 1 WHERE kroger_calls.n < $1
     RETURNING n`,
    [KROGER_DAILY_CAP],
  )) as Row[];
  return rows[0] ? Number(rows[0].n) : null;
}
