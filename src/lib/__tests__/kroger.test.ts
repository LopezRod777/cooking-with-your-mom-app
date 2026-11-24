// Sin red: fetch se reemplaza por un fake que responde según la URL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetKrogerTokenCache,
  fetchStorePrices,
  findKrogerLocation,
  getToken,
  isConfigured,
  normalizeSize,
  PRODUCT_BATCH,
  type ProductRef,
} from "../places/kroger";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let now: number;
let tokenSeq: number;
let locations: unknown[];
let products: (ids: string[]) => unknown[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function installFetch(opts: { expiresIn?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/connect/oauth2/token")) {
        tokenSeq += 1;
        return jsonResponse({ access_token: `tok-${tokenSeq}`, expires_in: opts.expiresIn ?? 1800 });
      }
      if (url.includes("/v1/locations")) return jsonResponse({ data: locations });
      if (url.includes("/v1/products")) {
        const ids = new URL(url).searchParams.get("filter.productId")!.split(",");
        return jsonResponse({ data: products(ids) });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }),
  );
}

beforeEach(() => {
  calls = [];
  now = 1_000_000_000_000;
  tokenSeq = 0;
  locations = [];
  products = () => [];
  vi.spyOn(Date, "now").mockImplementation(() => now);
  process.env.KROGER_CLIENT_ID = "test-id";
  process.env.KROGER_CLIENT_SECRET = "test-secret";
  _resetKrogerTokenCache();
  installFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
});

const tokenCalls = () => calls.filter((c) => c.url.includes("/connect/oauth2/token")).length;

describe("isConfigured", () => {
  it("requiere ambas variables", () => {
    expect(isConfigured()).toBe(true);
    delete process.env.KROGER_CLIENT_SECRET;
    expect(isConfigured()).toBe(false);
  });
});

describe("getToken", () => {
  it("usa Basic auth y el cuerpo de client credentials", async () => {
    await getToken();
    const call = calls[0];
    expect(call.url).toBe("https://api.kroger.com/v1/connect/oauth2/token");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("test-id:test-secret").toString("base64")}`);
    expect(String(call.init.body)).toBe("grant_type=client_credentials&scope=product.compact");
  });

  it("reutiliza el token en la segunda llamada", async () => {
    const a = await getToken();
    const b = await getToken();
    expect(a).toBe("tok-1");
    expect(b).toBe("tok-1");
    expect(tokenCalls()).toBe(1);
  });

  it("renueva 60 s antes de que venza", async () => {
    await getToken(); // expires_in 1800 → válido hasta now + 1740 s
    now += 1740_000 - 1;
    expect(await getToken()).toBe("tok-1");
    now += 1; // exactamente en el umbral
    expect(await getToken()).toBe("tok-2");
    expect(tokenCalls()).toBe(2);
  });

  it("una sola petición de token aunque haya llamadas concurrentes", async () => {
    const [a, b] = await Promise.all([getToken(), getToken()]);
    expect(a).toBe(b);
    expect(tokenCalls()).toBe(1);
  });
});

describe("findKrogerLocation", () => {
  const origin = { lat: 39.9839, lng: -105.2486 };
  const near = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });

  it("elige la tienda Kroger más cercana que comparte palabra con el nombre OSM", async () => {
    locations = [
      // Mismo nombre, pero a ~0.5 mi: fuera del radio de 0.3 mi.
      { locationId: "far", chain: "KING SOOPERS", name: "King Soopers Far", geolocation: near(39.9839, -105.2486 + 0.0095) },
      // Cercana, marca Kroger, nombre compartido ("King Soopers"): debe ganar.
      { locationId: "best", chain: "KING SOOPERS", name: "King Soopers Table Mesa", geolocation: near(39.9842, -105.2490) },
      // Cercana pero no es de la familia Kroger.
      { locationId: "safeway", chain: "SAFEWAY", name: "Safeway King Soopers", geolocation: near(39.9841, -105.2488) },
    ];
    const loc = await findKrogerLocation({ ...origin, name: "King Soopers" });
    expect(loc).toEqual({ locationId: "best", name: "King Soopers Table Mesa", chain: "KING SOOPERS" });
    const url = new URL(calls.find((c) => c.url.includes("/v1/locations"))!.url);
    expect(url.searchParams.get("filter.radiusInMiles")).toBe("1");
    expect(url.searchParams.get("filter.limit")).toBe("5");
  });

  it("reconoce la cadena sin espacios que devuelve Kroger (KINGSOOPERS)", async () => {
    locations = [
      { locationId: "tm", chain: "KINGSOOPERS", name: "King Soopers - TABLE MESA", geolocation: near(39.9842, -105.2490) },
    ];
    expect(await findKrogerLocation({ ...origin, name: "King Soopers" })).toEqual({
      locationId: "tm",
      name: "King Soopers - TABLE MESA",
      chain: "KINGSOOPERS",
    });
  });

  it("null si ninguna cumple nombre, familia y distancia", async () => {
    locations = [
      { locationId: "x", chain: "KROGER", name: "Kroger Downtown", geolocation: near(39.9839, -105.2486) },
    ];
    expect(await findKrogerLocation({ ...origin, name: "Whole Foods" })).toBeNull();
  });

  it("no empareja solo por la palabra genérica 'market'", async () => {
    locations = [{ locationId: "cm", chain: "CITY MARKET", name: "City Market", geolocation: near(39.9839, -105.2486) }];
    expect(await findKrogerLocation({ ...origin, name: "Denver Market Place" })).toBeNull();
  });
});

describe("fetchStorePrices", () => {
  it("mapea productId a clave del catálogo y marca tamaño distinto y fuera de tienda", async () => {
    const refs: Record<string, ProductRef> = {
      milk: { productId: "P1", size: "1 gal" },
      eggs: { productId: "P2", size: "12 ct" },
      rice: { productId: "P3", size: "2 lb" },
      cream: { productId: "P5", size: "1 gal" },
      oats: { productId: "P4", size: "18 oz" },
    };
    products = () => [
      { productId: "P1", items: [{ size: "1 gal", price: { regular: 4.19 }, fulfillment: { inStore: true } }] },
      { productId: "P2", items: [{ size: "18 ct", price: { regular: 5.5 }, fulfillment: { inStore: true } }] },
      { productId: "P3", items: [{ size: "2 lb", price: { regular: 3.0, promo: 2.5 }, fulfillment: { inStore: false } }] },
      { productId: "P5", items: [{ size: "1 gal", price: { regular: 2.79, promo: 2.79 }, fulfillment: { inStore: true } }] },
    ];
    const out = await fetchStorePrices("L1", refs);

    expect(out.milk).toEqual({
      productId: "P1", size: "1 gal", found: true, regular: 4.19, itemSize: "1 gal", inStore: true, matchesSize: true,
    });
    expect(out.eggs.matchesSize).toBe(false);
    expect(out.eggs.inStore).toBe(true);
    expect(out.rice).toMatchObject({ regular: 3.0, promo: 2.5, inStore: false, matchesSize: true });
    expect(out.cream.promo).toBeUndefined();
    expect(out.oats).toMatchObject({ found: false, regular: null, inStore: false, matchesSize: false });

    const call = calls.find((c) => c.url.includes("/v1/products"))!;
    expect(call.url).toContain("filter.productId=P1,P2,P3,P5,P4");
    expect(call.url).toContain("filter.locationId=L1");
  });

  it("parte más de 50 productIds en lotes", async () => {
    const refs: Record<string, ProductRef> = {};
    for (let i = 0; i < 120; i++) refs[`k${i}`] = { productId: `P${i}`, size: "1 ct" };
    products = (ids) => ids.map((id) => ({ productId: id, items: [] }));
    const out = await fetchStorePrices("L1", refs);

    const productCalls = calls.filter((c) => c.url.includes("/v1/products"));
    expect(productCalls).toHaveLength(Math.ceil(120 / PRODUCT_BATCH));
    const sizes = productCalls.map((c) => new URL(c.url).searchParams.get("filter.productId")!.split(",").length);
    expect(sizes).toEqual([50, 50, 20]);
    expect(Object.keys(out)).toHaveLength(120);
  });
});

describe("normalizeSize", () => {
  it("iguala formatos equivalentes y no iguala tamaños distintos", () => {
    expect(normalizeSize("16 ounces")).toBe(normalizeSize("16 oz"));
    expect(normalizeSize("15.5 oz")).toBe(normalizeSize("15.5oz"));
    expect(normalizeSize("12 count")).toBe(normalizeSize("12 ct"));
    expect(normalizeSize("64 fl oz")).toBe(normalizeSize("64 Fluid Ounces"));
    expect(normalizeSize("12 ct")).not.toBe(normalizeSize("18 ct"));
  });

  it("conserva el decimal: 1.5 oz no es 15 oz", () => {
    expect(normalizeSize("1.5 oz")).not.toBe(normalizeSize("15 oz"));
    expect(normalizeSize("2.5 lb")).not.toBe(normalizeSize("25 lb"));
    expect(normalizeSize("1.5 lb")).toBe(normalizeSize("1.5 pounds"));
  });

  it("unidades: lbs, gallon y abreviaturas con punto", () => {
    expect(normalizeSize("2 lbs")).toBe(normalizeSize("2 lb"));
    expect(normalizeSize("1 Gallon")).toBe(normalizeSize("1 gal"));
    expect(normalizeSize("64 fl. oz.")).toBe(normalizeSize("64 fl oz"));
  });
});

describe("fetchStorePrices: tamaño con decimales", () => {
  it("1.5 oz del mapa no empareja con 15 oz de la tienda", async () => {
    products = () => [
      { productId: "P9", items: [{ size: "15 oz", price: { regular: 2.0 }, fulfillment: { inStore: true } }] },
    ];
    const out = await fetchStorePrices("L1", { snack: { productId: "P9", size: "1.5 oz" } });
    expect(out.snack).toMatchObject({ found: true, inStore: true, matchesSize: false });
  });
});

describe("fetchStorePrices: precio sin redondeo", () => {
  it("regular y promo pasan tal cual (1.234 sigue siendo 1.234)", async () => {
    products = () => [
      { productId: "P1", items: [{ size: "1 ct", price: { regular: 1.234, promo: 1.111 }, fulfillment: { inStore: true } }] },
    ];
    const out = await fetchStorePrices("L1", { x: { productId: "P1", size: "1 ct" } });
    expect(out.x.regular).toBe(1.234);
    expect(out.x.promo).toBe(1.111);
  });
});

describe("no-store hacia Kroger", () => {
  it("token, locations y products se piden con cache no-store", async () => {
    locations = [{ locationId: "best", chain: "KING SOOPERS", name: "King Soopers", geolocation: { latitude: 39.9842, longitude: -105.249 } }];
    products = () => [{ productId: "P1", items: [{ size: "1 ct", price: { regular: 1 }, fulfillment: { inStore: true } }] }];
    await findKrogerLocation({ lat: 39.9839, lng: -105.2486, name: "King Soopers" });
    await fetchStorePrices("best", { x: { productId: "P1", size: "1 ct" } });
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.init.cache === "no-store")).toBe(true);
  });
});
