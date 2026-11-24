// Recotiza botellas ya elegidas (hasta 12 productIds) en la tienda preferida. Solo Kroger, detrás del gate 21+.
// Sin caché: Cache-Control private, no-store.
import { getSql } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/auth/requireUser";
import { requirePairingsGate } from "../../../../../lib/pairings/cookie";
import { afterUpstream } from "../../../../../lib/pairings/afterUpstream";
import { reserveKrogerCall } from "../../../../../lib/places/krogerBudget";
import { fetchDrinkQuote, KrogerError, resolvePreferredKroger } from "../../../../../lib/places/kroger";

export const maxDuration = 60;

const MAX_PRODUCT_IDS = 12;
const NO_STORE = "private, no-store";

function withNoStore(res: Response): Response {
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

function send(body: Record<string, unknown>, status = 200): Response {
  return withNoStore(Response.json(body, { status }));
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

  const productIds = [...new Set((params.get("productIds") ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  if (productIds.length < 1 || productIds.length > MAX_PRODUCT_IDS) return send({ error: "bad_product_ids" }, 400);
  if (productIds.some((id) => !/^\d{13}$/.test(id))) return send({ error: "bad_product_ids" }, 400);

  try {
    const rows = (await getSql().query("select state from app_state where user_id = $1", [u.userId])) as Array<{
      state: { places?: { activeId?: unknown; preferredStore?: { id?: unknown } } } | null;
    }>;
    const target = await resolvePreferredKroger(rows[0]?.state?.places, loc, storeId);
    // The Locations lookup may have run upstream: a session locked meanwhile gets 403 on every return below.
    const lockedAfterLookup = await afterUpstream();
    if (lockedAfterLookup) return lockedAfterLookup;
    if (target.kind === "pending_sync") return send({ kind: "pending_sync", retryAfterS: 2, storeId });
    if (target.kind === "loc_mismatch") return send({ error: "loc_mismatch" }, 400);
    if (target.kind === "no_store") return send({ kind: "no_store", storeId });
    if (target.kind === "not_kroger") return send({ kind: "not_kroger", storeId });

    const quotedAt = new Date().toISOString();
    const reserved = await reserveKrogerCall();
    const quote = reserved === null ? { kind: "unavailable" as const } : await fetchDrinkQuote(target.store.locationId, productIds);
    const items = quote.kind === "ok" ? quote.items : [];

    // La sesión pudo bloquearse mientras Kroger respondía: se descarta la respuesta.
    const lockedAfterQuote = await afterUpstream();
    if (lockedAfterQuote) return lockedAfterQuote;

    const kind = quote.kind === "unavailable" ? "unavailable" : items.length > 0 ? "ok" : "none";
    return send({
      kind,
      storeId: target.storeId,
      store: target.store,
      quotedAt,
      items,
      complete: items.length === productIds.length,
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
