import { getSql } from "../../../lib/db";
import { requireUser } from "../../../lib/auth/requireUser";
import { CATALOG } from "../../../lib/catalog";
import productJson from "../../../../data/kroger-products.json";
import { PreferredStore } from "../../../lib/schemas";
import {
  fetchStorePrices,
  findKrogerLocation,
  isConfigured,
  KrogerError,
  type ProductMap,
  type ProductRef,
} from "../../../lib/places/kroger";
import { reserveKrogerCall } from "../../../lib/places/krogerBudget";

export const maxDuration = 60;

const MAX_KEYS = 60;
// Precios de Kroger: nada se guarda en caché (términos §5(e)); tampoco en el navegador.
const NO_STORE = "private, no-store";

// Mapa curado (import estático, va en el bundle): { catalogKey: { productId, size } }.
// Solo claves del catálogo; el JSON no lleva metadatos.
const PRODUCT_MAP: ProductMap = Object.fromEntries(
  Object.entries(productJson as ProductMap).filter(([key]) => key in CATALOG),
);

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

  const params = new URL(req.url).searchParams;
  const loc = params.get("loc") ?? "";
  if (loc.length < 1 || loc.length > 40) return send({ error: "bad_loc" }, 400);

  const keys = [...new Set((params.get("keys") ?? "").split(",").map((k) => k.trim()).filter(Boolean))];
  if (keys.length < 1 || keys.length > MAX_KEYS) return send({ error: "bad_keys" }, 400);

  // Tienda que el cliente cree tener seleccionada; la respuesta se ata a ella con storeId.
  const storeId = params.get("store") ?? "";
  if (storeId.length < 1 || storeId.length > 80) return send({ error: "bad_store" }, 400);

  if (!isConfigured()) return send({ status: "not_configured", storeId });

  const rows = (await getSql().query("select state from app_state where user_id = $1", [u.userId])) as Array<{
    state: { places?: { activeId?: unknown; preferredStore?: { id?: unknown } } } | null;
  }>;
  const places = rows[0]?.state?.places;

  // La selección del cliente aún no llegó a la cuenta: no se consulta nada.
  if (places?.preferredStore?.id !== storeId) return send({ status: "pending_sync", retryAfterS: 2, storeId });
  if (places?.activeId !== loc) return send({ error: "loc_mismatch" }, 400);

  const store = PreferredStore.safeParse(places?.preferredStore);
  if (!store.success) return send({ status: "no_store", storeId });

  // null = ya se buscó y no es tienda Kroger: no se vuelve a llamar a Locations.
  if (store.data.krogerLocationId === null) return send({ status: "no_store", storeId });

  try {
    let storeInfo = { locationId: store.data.krogerLocationId ?? "", name: store.data.name };
    if (!storeInfo.locationId) {
      const found = await findKrogerLocation({ lat: store.data.lat, lng: store.data.lng, name: store.data.name });
      if (!found) return send({ status: "no_store", checked: true, storeId });
      storeInfo = { locationId: found.locationId, name: found.name };
    }

    const refs: Record<string, ProductRef> = {};
    for (const key of keys) if (PRODUCT_MAP[key]) refs[key] = PRODUCT_MAP[key];

    const quotedAt = new Date().toISOString();
    // Cada llamada a Products se reserva en el contador diario; sin cupo no se llama a Kroger.
    const priced = await fetchStorePrices(storeInfo.locationId, refs, {
      beforeCall: async () => (await reserveKrogerCall()) !== null,
    });

    const prices: Record<string, { regular: number; promo?: number; size: string; inStore: true }> = {};
    for (const [key, p] of Object.entries(priced)) {
      if (!p.found || !p.inStore || !p.matchesSize || p.regular === null) continue;
      prices[key] = { regular: p.regular, ...(p.promo !== undefined ? { promo: p.promo } : {}), size: p.size, inStore: true };
    }
    return send({ status: "ok", storeId: store.data.id, store: storeInfo, quotedAt, cache: "none", prices });
  } catch (err) {
    if (err instanceof KrogerError && err.status === "budget") {
      return send({ status: "unavailable", storeId, reason: "daily_budget", cache: "none" });
    }
    if (err instanceof KrogerError) return send({ status: "unavailable", storeId, reason: `upstream_${err.status}` });
    throw err;
  }
}
