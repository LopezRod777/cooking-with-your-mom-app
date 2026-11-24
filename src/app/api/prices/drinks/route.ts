// Botellas con precio en la tienda preferida (solo Kroger). Detrás del gate 21+ antes y después de Kroger.
// Sin caché: Cache-Control private, no-store (términos §5(e), docs/PLAN-TIENDAS.md C).
import { getSql } from "../../../../lib/db";
import { requireUser } from "../../../../lib/auth/requireUser";
import { requirePairingsGate } from "../../../../lib/pairings/cookie";
import { afterUpstream } from "../../../../lib/pairings/afterUpstream";
import { searchTermFor } from "../../../../lib/pairings/vocab";
import { reserveKrogerCall } from "../../../../lib/places/krogerBudget";
import {
  effectivePrice,
  KrogerError,
  resolvePreferredKroger,
  searchDrinks,
  type DrinkItem,
} from "../../../../lib/places/kroger";

export const maxDuration = 60;

const NO_STORE = "private, no-store";

function withNoStore(res: Response): Response {
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

function send(body: Record<string, unknown>, status = 200): Response {
  return withNoStore(Response.json(body, { status }));
}

type SearchOutcome = { kind: "ok" | "none" | "unavailable"; items: DrinkItem[]; quotedAt: string };

// Búsquedas en vuelo por locationId|término: dos peticiones iguales comparten una sola llamada a Kroger.
// El cupo se reserva dentro de la llamada compartida, así que una petición unida no gasta cupo.
const inflight = new Map<string, Promise<SearchOutcome>>();

function searchShared(locationId: string, term: string): Promise<SearchOutcome> {
  const key = `${locationId}|${term}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = (async (): Promise<SearchOutcome> => {
    if ((await reserveKrogerCall()) === null) return { kind: "unavailable", items: [], quotedAt: new Date().toISOString() };
    const quotedAt = new Date().toISOString();
    const result = await searchDrinks(locationId, term);
    if (result.kind === "unavailable") return { kind: "unavailable", items: [], quotedAt };
    return { kind: result.items.length > 0 ? "ok" : "none", items: result.items, quotedAt };
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

// Presupuesto de bebidas del perfil (campo nuevo del estado). Ausente o no numérico = null.
function drinksBudgetOf(state: unknown): number | null {
  const profile = (state as { profile?: { drinksBudgetUsd?: unknown } } | null)?.profile;
  const value = profile?.drinksBudgetUsd;
  return typeof value === "number" ? value : null;
}

export async function GET(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return withNoStore(u);
  const gate = await requirePairingsGate();
  if (gate instanceof Response) return withNoStore(gate);

  const params = new URL(req.url).searchParams;
  const loc = params.get("loc") ?? "";
  if (loc.length < 1 || loc.length > 40) return send({ error: "bad_loc" }, 400);
  const storeId = params.get("store") ?? "";
  if (storeId.length < 1 || storeId.length > 80) return send({ error: "bad_store" }, 400);

  try {
    const rows = (await getSql().query("select state from app_state where user_id = $1", [u.userId])) as Array<{
      state: { places?: { activeId?: unknown; preferredStore?: { id?: unknown } } } | null;
    }>;
    const state = rows[0]?.state ?? null;

    const target = await resolvePreferredKroger(state?.places, loc, storeId);
    // The Locations lookup may have run upstream: a session locked meanwhile gets 403 on every return below.
    const lockedAfterLookup = await afterUpstream();
    if (lockedAfterLookup) return lockedAfterLookup;
    if (target.kind === "pending_sync") return send({ kind: "pending_sync", retryAfterS: 2, storeId });
    if (target.kind === "loc_mismatch") return send({ error: "loc_mismatch" }, 400);
    if (target.kind === "no_store") return send({ kind: "no_store", storeId });
    if (target.kind === "not_kroger") return send({ kind: "not_kroger", storeId });

    const term = searchTermFor(params.get("styleId") ?? "");
    if (term === null) return send({ error: "bad_style" }, 400);

    const outcome = await searchShared(target.store.locationId, term);

    // La sesión pudo bloquearse mientras Kroger respondía: se descarta la respuesta.
    const lockedAfterSearch = await afterUpstream();
    if (lockedAfterSearch) return lockedAfterSearch;

    const budget = drinksBudgetOf(state);
    const items = outcome.items.map((item) => ({
      ...item,
      withinBudget: budget === null ? null : effectivePrice(item) <= budget,
    }));
    return send({
      kind: outcome.kind,
      storeId: target.storeId,
      store: target.store,
      quotedAt: outcome.quotedAt,
      items,
      drinksBudgetUsd: budget,
    });
  } catch (err) {
    if (err instanceof KrogerError) {
      // The upstream error may come after a lock: the 403 wins over the unavailable answer.
      const lockedAfterError = await afterUpstream();
      return lockedAfterError ?? send({ kind: "unavailable", storeId });
    }
    throw err;
  }
}
