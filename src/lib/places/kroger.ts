// Kroger Public API: ubicación más cercana y precio por tienda. Solo servidor.
// Nunca registra tokens, secretos ni coordenadas: los errores llevan solo el código HTTP.
import { z } from "zod";
import { haversineMi } from "../geo";
import { PreferredStore } from "../schemas";

const BASE = "https://api.kroger.com/v1";
const TOKEN_URL = `${BASE}/connect/oauth2/token`;
const TIMEOUT_MS = 10_000;
// El token se renueva 60 s antes de vencer.
const REFRESH_MARGIN_MS = 60_000;
export const PRODUCT_BATCH = 50;
export const LOCATION_RADIUS_MI = 0.3;

export const KROGER_BRANDS = [
  "King Soopers",
  "City Market",
  "Kroger",
  "Fred Meyer",
  "Ralphs",
  "Smith's",
  "Fry's",
  "QFC",
  "Harris Teeter",
  "Dillons",
  "Pick 'n Save",
  "Mariano's",
  "Food 4 Less",
];

// Palabras que no sirven para emparejar nombres ("City Market" no debe emparejar con cualquier "Market").
const STOP_WORDS = new Set(["the", "and", "store", "stores", "food", "foods", "market", "supermarket"]);

export class KrogerError extends Error {
  readonly status: number | "network" | "not_configured" | "budget";
  constructor(status: number | "network" | "not_configured" | "budget") {
    super(`kroger ${status}`);
    this.status = status;
  }
}

export function isConfigured(): boolean {
  return Boolean(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET);
}

const TokenBody = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });

let cached: { value: string; expiresAt: number } | undefined;
let inflight: Promise<string> | undefined;

// Test-only: vacía el token en memoria.
export function _resetKrogerTokenCache(): void {
  cached = undefined;
  inflight = undefined;
}

async function requestToken(): Promise<string> {
  const id = process.env.KROGER_CLIENT_ID;
  const secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) throw new KrogerError("not_configured");
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "product.compact" }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new KrogerError("network");
  }
  if (!res.ok) throw new KrogerError(res.status);
  const body = TokenBody.parse(await res.json());
  cached = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 - REFRESH_MARGIN_MS };
  return body.access_token;
}

// Token de client credentials en memoria; una sola petición en vuelo a la vez.
export async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  inflight ??= requestToken().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

// Consulta GET. El query se arma aparte para dejar las comas de filter.productId sin codificar.
async function kget(path: string, query: URLSearchParams, timeoutMs: number = TIMEOUT_MS): Promise<unknown> {
  const token = await getToken();
  const qs = query.toString().replace(/%2C/gi, ",");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new KrogerError("network");
  }
  if (res.status === 401) cached = undefined;
  if (!res.ok) throw new KrogerError(res.status);
  return res.json();
}

const LocationsBody = z.object({
  data: z.array(
    z.object({
      locationId: z.string(),
      chain: z.string().optional(),
      name: z.string().optional(),
      geolocation: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
    }),
  ),
});

function wordsOf(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

// Kroger devuelve la cadena sin espacios ("KINGSOOPERS"): se comparan solo letras y dígitos.
const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function isKrogerFamily(label: string): boolean {
  const l = bare(label);
  return KROGER_BRANDS.some((b) => l.includes(bare(b)));
}

export type KrogerLocation = { locationId: string; name: string; chain: string };

// Tienda de la familia Kroger a menos de LOCATION_RADIUS_MI que comparte una palabra con el nombre OSM.
// Si hay varias, gana la más cercana. null si no hay ninguna.
export async function findKrogerLocation(input: { lat: number; lng: number; name: string }): Promise<KrogerLocation | null> {
  const osmWords = wordsOf(input.name);
  if (osmWords.size === 0) return null;
  const query = new URLSearchParams({
    "filter.lat.near": String(input.lat),
    "filter.lon.near": String(input.lng),
    "filter.radiusInMiles": "1",
    "filter.limit": "5",
  });
  const body = LocationsBody.parse(await kget("/locations", query));

  let best: { dist: number; loc: KrogerLocation } | undefined;
  for (const row of body.data) {
    if (!row.geolocation) continue;
    const dist = haversineMi(input, { lat: row.geolocation.latitude, lng: row.geolocation.longitude });
    if (dist > LOCATION_RADIUS_MI) continue;
    // La familia se decide por la cadena; el nombre solo si la cadena no viene.
    if (!isKrogerFamily(row.chain || row.name || "")) continue;
    const label = `${row.chain ?? ""} ${row.name ?? ""}`;
    const labelWords = wordsOf(label);
    if (![...osmWords].some((w) => labelWords.has(w))) continue;
    if (!best || dist < best.dist) {
      best = { dist, loc: { locationId: row.locationId, name: row.name ?? "", chain: row.chain ?? "" } };
    }
  }
  return best?.loc ?? null;
}

// Clave del catálogo → producto Kroger curado. `size` es el tamaño de paquete esperado, exacto.
// data/kroger-products.json tiene exactamente esta forma: { "<catalogKey>": ProductRef }.
export type ProductRef = { productId: string; size: string };
export type ProductMap = Record<string, ProductRef>;

// Compara tamaños sin ruido de formato: "16 ounces" = "16 oz", "15.5 oz" = "15.5oz", "1 Gallon" = "1 gal".
// El decimal se conserva: "1.5 oz" ≠ "15 oz". Solo se quitan espacios, guiones y puntos de abreviatura.
export function normalizeSize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s-]/g, "")
    .replace(/\.(?!\d)/g, "")
    .replace(/fluidounces?/g, "floz")
    .replace(/fluidoz/g, "floz")
    .replace(/ounces?/g, "oz")
    .replace(/pounds?|lbs/g, "lb")
    .replace(/gallons?/g, "gal")
    .replace(/count/g, "ct");
}

export type StorePrice = {
  productId: string;
  size: string;
  found: boolean;
  regular: number | null;
  promo?: number;
  itemSize?: string;
  inStore: boolean;
  matchesSize: boolean;
};

const ProductsBody = z.object({
  data: z.array(
    z.object({
      productId: z.string(),
      items: z
        .array(
          z.object({
            size: z.string().optional(),
            price: z.object({ regular: z.number().optional(), promo: z.number().optional() }).optional(),
            fulfillment: z.object({ inStore: z.boolean().optional() }).optional(),
          }),
        )
        .optional(),
    }),
  ),
});

// Precio por tienda para cada clave. Lotes de hasta PRODUCT_BATCH productIds separados por coma.
// Solo cuenta como vivo (en la ruta) lo que trae inStore && matchesSize && regular.
export async function fetchStorePrices(
  locationId: string,
  products: Record<string, ProductRef>,
  options?: { beforeCall?: () => Promise<boolean> },
): Promise<Record<string, StorePrice>> {
  const keysById = new Map<string, string[]>();
  for (const [key, ref] of Object.entries(products)) {
    const list = keysById.get(ref.productId) ?? [];
    list.push(key);
    keysById.set(ref.productId, list);
  }
  const ids = [...keysById.keys()];
  const out: Record<string, StorePrice> = {};

  for (let i = 0; i < ids.length; i += PRODUCT_BATCH) {
    const chunk = ids.slice(i, i + PRODUCT_BATCH);
    // Cada llamada a Products pasa por el presupuesto diario; false = no se llama a Kroger.
    if (options?.beforeCall && !(await options.beforeCall())) throw new KrogerError("budget");
    const body = ProductsBody.parse(
      await kget(
        "/products",
        new URLSearchParams({ "filter.productId": chunk.join(","), "filter.locationId": locationId }),
      ),
    );
    for (const row of body.data) {
      for (const key of keysById.get(row.productId) ?? []) {
        const size = products[key].size;
        const item = row.items?.[0];
        const regular = item?.price?.regular;
        const promo = item?.price?.promo;
        out[key] = {
          productId: row.productId,
          size,
          found: true,
          regular: typeof regular === "number" ? regular : null,
          // Kroger puede devolver promo igual a regular (sin oferta real): solo cuenta si es menor.
          ...(typeof promo === "number" && typeof regular === "number" && promo > 0 && promo < regular ? { promo } : {}),
          itemSize: item?.size,
          inStore: item?.fulfillment?.inStore === true,
          matchesSize: item?.size !== undefined && normalizeSize(item.size) === normalizeSize(size),
        };
      }
    }
  }

  for (const [key, ref] of Object.entries(products)) {
    if (out[key]) continue;
    out[key] = {
      productId: ref.productId,
      size: ref.size,
      found: false,
      regular: null,
      inStore: false,
      matchesSize: false,
    };
  }
  return out;
}

// ---- Bebidas (botellas con precio en la tienda preferida, docs/PLAN-PAIRINGS-PRESUPUESTO.md B) ----

const DRINK_TIMEOUT_MS = 8_000;
const DRINK_SEARCH_LIMIT = 12;
const DRINK_SHOWN = 3;
const ADULT_BEVERAGE = "Adult Beverage";

export type DrinkItem = {
  productId: string;
  description: string;
  brand: string | null;
  size: string | null;
  regular: number;
  promo: number | null;
  inStore: boolean;
};

export type DrinkSearchResult = { kind: "ok"; items: DrinkItem[] } | { kind: "unavailable" };
export type DrinkQuoteResult = { kind: "ok"; items: DrinkItem[] } | { kind: "unavailable" };

const DrinkProductsBody = z.object({
  data: z.array(
    z.object({
      productId: z.string(),
      description: z.string().optional(),
      brand: z.string().optional(),
      categories: z.array(z.string()).optional(),
      items: z
        .array(
          z.object({
            size: z.string().optional(),
            price: z.object({ regular: z.number().optional(), promo: z.number().optional() }).optional(),
            fulfillment: z.object({ inStore: z.boolean().optional() }).optional(),
          }),
        )
        .optional(),
    }),
  ),
});
type DrinkRow = z.infer<typeof DrinkProductsBody>["data"][number];

// Precio, tamaño e inStore salen todos de items[0]. Null si no hay precio regular > 0.
// Promo cuenta solo si es menor que regular (misma regla que fetchStorePrices).
function drinkItemOf(row: DrinkRow): DrinkItem | null {
  const item = row.items?.[0];
  const regular = item?.price?.regular;
  if (typeof regular !== "number" || regular <= 0) return null;
  const promo = item?.price?.promo;
  return {
    productId: row.productId,
    description: row.description ?? "",
    brand: row.brand ?? null,
    size: item?.size ?? null,
    regular,
    promo: typeof promo === "number" && promo > 0 && promo < regular ? promo : null,
    inStore: item?.fulfillment?.inStore === true,
  };
}

export const effectivePrice = (item: Pick<DrinkItem, "regular" | "promo">): number => item.promo ?? item.regular;

// Sin acentos ni mayúsculas. Una palabra del término (3+ letras) debe aparecer en la descripción.
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function matchesTerm(description: string, term: string): boolean {
  const words = fold(term).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const text = fold(description);
  return words.some((w) => text.includes(w));
}

// Búsqueda de bebidas en la tienda. Sin reintentos; 429, 5xx, timeout o respuesta inválida → unavailable.
export async function searchDrinks(locationId: string, term: string): Promise<DrinkSearchResult> {
  try {
    const body = DrinkProductsBody.parse(
      await kget(
        "/products",
        new URLSearchParams({
          "filter.term": term,
          "filter.locationId": locationId,
          "filter.limit": String(DRINK_SEARCH_LIMIT),
        }),
        DRINK_TIMEOUT_MS,
      ),
    );
    const items = body.data
      .filter((row) => row.categories?.includes(ADULT_BEVERAGE) === true)
      .filter((row) => matchesTerm(row.description ?? "", term))
      .map(drinkItemOf)
      .filter((item): item is DrinkItem => item !== null)
      .sort((a, b) => effectivePrice(a) - effectivePrice(b))
      .slice(0, DRINK_SHOWN);
    return { kind: "ok", items };
  } catch (err) {
    if (err instanceof KrogerError || err instanceof z.ZodError) return { kind: "unavailable" };
    throw err;
  }
}

// Precio actual de hasta 12 productIds en una sola llamada. Los que no devuelven precio no entran en items.
export async function fetchDrinkQuote(locationId: string, productIds: string[]): Promise<DrinkQuoteResult> {
  try {
    const body = DrinkProductsBody.parse(
      await kget(
        "/products",
        new URLSearchParams({
          "filter.productId": productIds.join(","),
          "filter.locationId": locationId,
          "filter.limit": String(productIds.length),
        }),
        DRINK_TIMEOUT_MS,
      ),
    );
    const byId = new Map<string, DrinkItem>();
    for (const row of body.data) {
      const item = drinkItemOf(row);
      if (item) byId.set(row.productId, item);
    }
    return { kind: "ok", items: productIds.flatMap((id) => (byId.has(id) ? [byId.get(id) as DrinkItem] : [])) };
  } catch (err) {
    if (err instanceof KrogerError || err instanceof z.ZodError) return { kind: "unavailable" };
    throw err;
  }
}

// Resuelve la tienda preferida igual que /api/prices, sin llamar a Products.
// Se llama después de requireUser y requirePairingsGate.
export type PreferredKroger =
  | { kind: "ok"; storeId: string; store: { locationId: string; name: string } }
  | { kind: "pending_sync" }
  | { kind: "loc_mismatch" }
  | { kind: "no_store" }
  | { kind: "not_kroger" };

export async function resolvePreferredKroger(
  places: { activeId?: unknown; preferredStore?: { id?: unknown } } | null | undefined,
  loc: string,
  storeId: string,
): Promise<PreferredKroger> {
  if (places?.preferredStore?.id !== storeId) return { kind: "pending_sync" };
  if (places?.activeId !== loc) return { kind: "loc_mismatch" };
  const parsed = PreferredStore.safeParse(places?.preferredStore);
  if (!parsed.success) return { kind: "no_store" };
  const store = parsed.data;
  // null = ya se buscó y no es Kroger. undefined = no buscada: se consulta Locations una vez.
  if (store.krogerLocationId === null) return { kind: "not_kroger" };
  if (store.krogerLocationId) {
    return { kind: "ok", storeId: store.id, store: { locationId: store.krogerLocationId, name: store.name } };
  }
  const found = await findKrogerLocation({ lat: store.lat, lng: store.lng, name: store.name });
  if (!found) return { kind: "not_kroger" };
  return { kind: "ok", storeId: store.id, store: { locationId: found.locationId, name: found.name } };
}
