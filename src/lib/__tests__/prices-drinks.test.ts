// Rutas de botellas (/api/prices/drinks y /quote) con DB, sesión, gate y fetch simulados. Sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db";
import { requireUser } from "../auth/requireUser";
import { requirePairingsGate } from "../pairings/cookie";
import { _resetKrogerTokenCache, matchesTerm } from "../places/kroger";
import { searchTermFor } from "../pairings/vocab";
import { reserveKrogerCall } from "../places/krogerBudget";
import { GET as drinksGet } from "../../app/api/prices/drinks/route";
import { GET as quoteGet } from "../../app/api/prices/drinks/quote/route";
import { GET as pricesGet } from "../../app/api/prices/route";

vi.mock("../db", () => ({ getSql: vi.fn() }));
vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn() }));
vi.mock("../pairings/cookie", () => ({ requirePairingsGate: vi.fn() }));

const NO_STORE = "private, no-store";
const LOC = "abc";
const STORE_ID = "osm:node/1";
const LOCATION = "62000033";
const PRODUCT_IDS_13 = ["0000000000001", "0000000000002", "0000000000003"];
const OPEN = { userId: "u1", email: "x@y.z" };
const LOCKED = () => Response.json({ error: "locked" }, { status: 403, headers: { "Cache-Control": NO_STORE } });

let urls: string[];
let counterRows: unknown[];
let state: unknown;
let productsResponder: () => Response;
let locationsResponder: () => Response;
let gateRelease: Promise<void>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const productsCalls = () => urls.filter((u) => u.includes("/v1/products")).length;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/connect/oauth2/token")) return json({ access_token: "t", expires_in: 1800 });
      if (url.includes("/v1/products")) {
        await gateRelease;
        return productsResponder();
      }
      if (url.includes("/v1/locations")) return locationsResponder();
      return json({});
    }),
  );
}

function stateRow(extra: Record<string, unknown> = {}) {
  return {
    places: { activeId: LOC, preferredStore: { id: STORE_ID, name: "King Soopers Table Mesa", lat: 39.98, lng: -105.24, krogerLocationId: LOCATION } },
    ...extra,
  };
}

function mockDb() {
  vi.mocked(getSql).mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.includes("kroger_calls")) return counterRows;
      return [{ state }];
    }),
  } as unknown as ReturnType<typeof getSql>);
}

const row = (productId: string, description: string, o: { regular?: number; promo?: number; categories?: string[]; inStore?: boolean } = {}) => ({
  productId,
  description,
  brand: "Brand",
  categories: o.categories ?? ["Adult Beverage"],
  items: [
    {
      size: "750 ml",
      price: { regular: o.regular ?? 12, ...(o.promo !== undefined ? { promo: o.promo } : {}) },
      fulfillment: { inStore: o.inStore ?? true },
    },
  ],
});

const drinksReq = (opts: { loc?: string; store?: string; styleId?: string } = {}) => {
  const q = new URLSearchParams({ loc: opts.loc ?? LOC, store: opts.store ?? STORE_ID, styleId: opts.styleId ?? "dry-riesling" });
  return new Request(`http://x/api/prices/drinks?${q.toString()}`);
};
const quoteReq = (opts: { productIds?: string; loc?: string } = {}) => {
  const q = new URLSearchParams({ loc: opts.loc ?? LOC, store: STORE_ID, productIds: opts.productIds ?? PRODUCT_IDS_13.join(",") });
  return new Request(`http://x/api/prices/drinks/quote?${q.toString()}`);
};

beforeEach(() => {
  urls = [];
  counterRows = [{ n: 1 }];
  state = stateRow();
  gateRelease = Promise.resolve();
  productsResponder = () => json({ data: [] });
  locationsResponder = () => json({ data: [] });
  process.env.KROGER_CLIENT_ID = "id";
  process.env.KROGER_CLIENT_SECRET = "secret";
  _resetKrogerTokenCache();
  vi.mocked(requireUser).mockResolvedValue(OPEN);
  vi.mocked(requirePairingsGate).mockResolvedValue({ userId: "u1" });
  mockDb();
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
});

describe("GET /api/prices/drinks: acceso y tienda", () => {
  it("403 sin gate y sin llamar a Kroger", async () => {
    vi.mocked(requirePairingsGate).mockResolvedValueOnce(LOCKED());
    const res = await drinksGet(drinksReq());
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
    expect(productsCalls()).toBe(0);
  });

  it("403 si el gate se cierra entre la llamada a Kroger y la respuesta; la respuesta se descarta", async () => {
    productsResponder = () => json({ data: [row("0000000000001", "Riesling Dry")] });
    vi.mocked(requirePairingsGate)
      .mockResolvedValueOnce({ userId: "u1" }) // entrada
      .mockResolvedValueOnce({ userId: "u1" }) // tras la búsqueda de tienda
      .mockResolvedValueOnce(LOCKED()); // tras la búsqueda de productos
    const res = await drinksGet(drinksReq());
    expect(productsCalls()).toBe(1);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "locked" });
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
  });

  it("403 si el gate se cierra durante la búsqueda de la tienda en Kroger Locations", async () => {
    state = stateRow({ places: { activeId: LOC, preferredStore: { id: STORE_ID, name: "King Soopers Table Mesa", lat: 39.98, lng: -105.24 } } });
    mockDb();
    locationsResponder = () => json({ data: [] });
    vi.mocked(requirePairingsGate).mockResolvedValueOnce({ userId: "u1" }).mockResolvedValueOnce(LOCKED());
    const res = await drinksGet(drinksReq());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "locked" });
    expect(urls.some((u) => u.includes("/v1/locations"))).toBe(true);
    expect(productsCalls()).toBe(0);
  });

  it("403 si Kroger Locations falla con error y el gate se cerró; sin cierre, unavailable", async () => {
    state = stateRow({ places: { activeId: LOC, preferredStore: { id: STORE_ID, name: "King Soopers Table Mesa", lat: 39.98, lng: -105.24 } } });
    mockDb();
    locationsResponder = () => new Response("", { status: 500 });
    vi.mocked(requirePairingsGate).mockResolvedValueOnce({ userId: "u1" }).mockResolvedValueOnce(LOCKED());
    const locked = await drinksGet(drinksReq());
    expect(locked.status).toBe(403);
    expect(locked.headers.get("Cache-Control")).toBe(NO_STORE);

    const open = await drinksGet(drinksReq());
    expect(await open.json()).toMatchObject({ kind: "unavailable", storeId: STORE_ID });
    expect(productsCalls()).toBe(0);
  });

  it("loc distinto del activo: 400 loc_mismatch sin llamar a Kroger", async () => {
    state = stateRow({ places: { activeId: "otra", preferredStore: { id: STORE_ID, name: "KS", lat: 39.9, lng: -105.2, krogerLocationId: LOCATION } } });
    mockDb();
    const res = await drinksGet(drinksReq());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "loc_mismatch" });
    expect(productsCalls()).toBe(0);
  });

  it("tienda no sincronizada: pending_sync sin llamar a Kroger", async () => {
    const res = await drinksGet(drinksReq({ store: "osm:node/99" }));
    expect(await res.json()).toEqual({ kind: "pending_sync", retryAfterS: 2, storeId: "osm:node/99" });
    expect(productsCalls()).toBe(0);
  });

  it("krogerLocationId null: 200 not_kroger", async () => {
    state = stateRow({ places: { activeId: LOC, preferredStore: { id: STORE_ID, name: "Shop", lat: 42.3, lng: -71.1, krogerLocationId: null } } });
    mockDb();
    const res = await drinksGet(drinksReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "not_kroger", storeId: STORE_ID });
    expect(productsCalls()).toBe(0);
  });

  it("styleId desconocido o sin término de búsqueda: 400", async () => {
    expect((await drinksGet(drinksReq({ styleId: "no-such" }))).status).toBe(400);
    expect((await drinksGet(drinksReq({ styleId: "zero-proof-x" }))).status).toBe(400);
    expect(productsCalls()).toBe(0);
  });
});

describe("GET /api/prices/drinks: filtros y precios", () => {
  it("solo cuenta 'Adult Beverage' y que la descripción contenga una palabra del término", async () => {
    productsResponder = () =>
      json({
        data: [
          row("0000000000001", "Riesling Dry", { categories: ["Grocery"] }),
          row("0000000000002", "Sparkling Water Lime", { categories: ["Adult Beverage"] }),
          row("0000000000003", "Chateau Riesling Washington White Wine", { regular: 11.99 }),
        ],
      });
    const body = await (await drinksGet(drinksReq())).json();
    expect(body.kind).toBe("ok");
    expect(body.items.map((i: { productId: string }) => i.productId)).toEqual(["0000000000003"]);
  });

  it("ordena por precio efectivo (promo si hay) y devuelve como máximo 3; datos del mismo items[0]", async () => {
    productsResponder = () =>
      json({
        data: [
          row("0000000000001", "Riesling A", { regular: 20 }),
          row("0000000000002", "Riesling B", { regular: 15, promo: 9 }),
          row("0000000000003", "Riesling C", { regular: 12 }),
          row("0000000000004", "Riesling D", { regular: 30 }),
        ],
      });
    const body = await (await drinksGet(drinksReq())).json();
    expect(body.items.map((i: { productId: string }) => i.productId)).toEqual(["0000000000002", "0000000000003", "0000000000001"]);
    expect(body.items[0]).toMatchObject({ regular: 15, promo: 9, size: "750 ml", inStore: true, brand: "Brand" });
  });

  it("withinBudget con promo: cuenta el precio de oferta; sin presupuesto es null", async () => {
    productsResponder = () => json({ data: [row("0000000000001", "Riesling A", { regular: 12, promo: 9 }), row("0000000000002", "Riesling B", { regular: 12 })] });
    state = stateRow({ profile: { drinksBudgetUsd: 10 } });
    mockDb();
    const withBudget = await (await drinksGet(drinksReq())).json();
    expect(withBudget.drinksBudgetUsd).toBe(10);
    expect(withBudget.items.find((i: { productId: string }) => i.productId === "0000000000001").withinBudget).toBe(true);
    expect(withBudget.items.find((i: { productId: string }) => i.productId === "0000000000002").withinBudget).toBe(false);

    state = stateRow();
    mockDb();
    const noBudget = await (await drinksGet(drinksReq())).json();
    expect(noBudget.drinksBudgetUsd).toBeNull();
    expect(noBudget.items.every((i: { withinBudget: unknown }) => i.withinBudget === null)).toBe(true);
  });

  it("none cuando Kroger responde sin productos válidos", async () => {
    productsResponder = () => json({ data: [] });
    const body = await (await drinksGet(drinksReq())).json();
    expect(body).toMatchObject({ kind: "none", items: [] });
  });
});

describe("GET /api/prices/drinks: unavailable frente a none", () => {
  it.each([
    ["429", () => new Response("", { status: 429 })],
    ["500", () => new Response("", { status: 500 })],
    ["timeout", () => { throw new DOMException("timed out", "TimeoutError"); }],
  ])("%s → unavailable", async (_label, responder) => {
    productsResponder = responder as () => Response;
    const res = await drinksGet(drinksReq());
    expect(await res.json()).toMatchObject({ kind: "unavailable", storeId: STORE_ID });
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
  });

  it("contador agotado (sin fila) → unavailable sin llamar a Products", async () => {
    counterRows = [];
    mockDb();
    const res = await drinksGet(drinksReq());
    expect(await res.json()).toMatchObject({ kind: "unavailable" });
    expect(productsCalls()).toBe(0);
  });

  it("dos peticiones simultáneas iguales comparten una sola llamada a Kroger", async () => {
    let release!: () => void;
    gateRelease = new Promise<void>((r) => (release = r));
    productsResponder = () => json({ data: [row("0000000000001", "Riesling Dry")] });
    const pair = Promise.all([drinksGet(drinksReq()), drinksGet(drinksReq())]);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [a, b] = await pair;
    expect((await a.json()).items).toHaveLength(1);
    expect((await b.json()).items).toHaveLength(1);
    expect(productsCalls()).toBe(1);
  });
});

describe("GET /api/prices/drinks/quote", () => {
  it("403 sin gate", async () => {
    vi.mocked(requirePairingsGate).mockResolvedValueOnce(LOCKED());
    const res = await quoteGet(quoteReq());
    expect(res.status).toBe(403);
    expect(productsCalls()).toBe(0);
  });

  it("más de 12 ids o formato inválido: 400 sin llamar a Kroger", async () => {
    const many = Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(13, "0")).join(",");
    expect((await quoteGet(quoteReq({ productIds: many }))).status).toBe(400);
    expect((await quoteGet(quoteReq({ productIds: "123" }))).status).toBe(400);
    expect((await quoteGet(quoteReq({ productIds: "" }))).status).toBe(400);
    expect(productsCalls()).toBe(0);
  });

  it("loc_mismatch: 400", async () => {
    const res = await quoteGet(quoteReq({ loc: "otra" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "loc_mismatch" });
    expect(productsCalls()).toBe(0);
  });

  it("complete es false cuando falta un producto", async () => {
    productsResponder = () => json({ data: [row(PRODUCT_IDS_13[0], "Riesling A", { regular: 12 }), row(PRODUCT_IDS_13[1], "Riesling B", { regular: 14 })] });
    const body = await (await quoteGet(quoteReq())).json();
    expect(body.kind).toBe("ok");
    expect(body.items.map((i: { productId: string }) => i.productId)).toEqual([PRODUCT_IDS_13[0], PRODUCT_IDS_13[1]]);
    expect(body.complete).toBe(false);
  });

  it("complete es true con todos los ids; 403 si el gate cierra antes de responder", async () => {
    productsResponder = () => json({ data: PRODUCT_IDS_13.map((id) => row(id, "Riesling")) });
    const body = await (await quoteGet(quoteReq())).json();
    expect(body.complete).toBe(true);

    vi.mocked(requirePairingsGate)
      .mockResolvedValueOnce({ userId: "u1" })
      .mockResolvedValueOnce({ userId: "u1" })
      .mockResolvedValueOnce(LOCKED());
    const late = await quoteGet(quoteReq());
    expect(late.status).toBe(403);
    expect(productsCalls()).toBe(2);
  });

  it("403 si el gate se cierra durante la búsqueda de la tienda en Kroger Locations", async () => {
    state = stateRow({ places: { activeId: LOC, preferredStore: { id: STORE_ID, name: "King Soopers Table Mesa", lat: 39.98, lng: -105.24 } } });
    mockDb();
    locationsResponder = () => json({ data: [] });
    vi.mocked(requirePairingsGate).mockResolvedValueOnce({ userId: "u1" }).mockResolvedValueOnce(LOCKED());
    const res = await quoteGet(quoteReq());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "locked" });
    expect(productsCalls()).toBe(0);
  });

  it("403 si Kroger Locations falla con error y el gate se cerró; sin cierre, unavailable", async () => {
    state = stateRow({ places: { activeId: LOC, preferredStore: { id: STORE_ID, name: "King Soopers Table Mesa", lat: 39.98, lng: -105.24 } } });
    mockDb();
    locationsResponder = () => new Response("", { status: 500 });
    vi.mocked(requirePairingsGate).mockResolvedValueOnce({ userId: "u1" }).mockResolvedValueOnce(LOCKED());
    const locked = await quoteGet(quoteReq());
    expect(locked.status).toBe(403);
    expect(locked.headers.get("Cache-Control")).toBe(NO_STORE);

    const open = await quoteGet(quoteReq());
    expect(await open.json()).toMatchObject({ kind: "unavailable", storeId: STORE_ID });
    expect(productsCalls()).toBe(0);
  });

  it("contador agotado → unavailable sin llamar a Products", async () => {
    counterRows = [];
    mockDb();
    const body = await (await quoteGet(quoteReq())).json();
    expect(body).toMatchObject({ kind: "unavailable", complete: false, items: [] });
    expect(productsCalls()).toBe(0);
  });
});

describe("GET /api/prices: cupo diario de Kroger", () => {
  it("sin cupo: unavailable con daily_budget, cache none y sin llamar a Products", async () => {
    counterRows = [];
    mockDb();
    const q = new URLSearchParams({ loc: LOC, store: STORE_ID, keys: "almond_milk" });
    const res = await pricesGet(new Request(`http://x/api/prices?${q.toString()}`));
    expect(await res.json()).toMatchObject({ status: "unavailable", reason: "daily_budget", cache: "none", storeId: STORE_ID });
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
    expect(productsCalls()).toBe(0);
  });
});

describe("helpers de bebidas", () => {
  it("matchesTerm ignora acentos y mayúsculas", () => {
    expect(matchesTerm("Rosé de Provence", "rose wine")).toBe(true);
    expect(matchesTerm("Sparkling Water", "riesling")).toBe(false);
  });

  it("searchTermFor usa searchTerm, nombre si no hay, y null para ids sin bebida", () => {
    expect(searchTermFor("gamay-beaujolais")).toBe("beaujolais");
    expect(searchTermFor("pinot-noir")).toBe("Pinot Noir");
    expect(searchTermFor("dealcoholized-red")).toBeNull();
  });

  it("reserveKrogerCall devuelve el contador o null sin fila", async () => {
    expect(await reserveKrogerCall()).toBe(1);
    counterRows = [];
    mockDb();
    expect(await reserveKrogerCall()).toBeNull();
  });
});
