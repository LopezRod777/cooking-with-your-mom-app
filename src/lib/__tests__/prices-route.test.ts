// Ruta /api/prices con DB y sesión simulados, y fetch falso hacia Kroger. Sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db";
import { requireUser } from "../auth/requireUser";
import { _resetKrogerTokenCache } from "../places/kroger";
import { GET } from "../../app/api/prices/route";

vi.mock("../db", () => ({ getSql: vi.fn() }));
vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn(async () => ({ userId: "u1", email: "x@y.z" })) }));

const STORE_BASE = { id: "osm:node/1", name: "Safeway", lat: 39.9839, lng: -105.2486 };
const NO_STORE = "private, no-store";
let urls: string[];
let preferredStore: unknown;
let activeId: unknown;

function stateRow() {
  return [{ state: { places: { activeId, preferredStore } } }];
}

function installFetch(locationsData: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes("/connect/oauth2/token")) return json({ access_token: "t", expires_in: 1800 });
      if (url.includes("/v1/locations")) return json({ data: locationsData });
      if (url.includes("/v1/products")) {
        return json({
          data: [{ productId: "0002529300149", items: [{ size: "64 fl oz", price: { regular: 3.99 }, fulfillment: { inStore: true } }] }],
        });
      }
      return json({});
    }),
  );
}

const locationsCalls = () => urls.filter((u) => u.includes("/v1/locations")).length;
const krogerCalls = () => urls.length;

beforeEach(() => {
  urls = [];
  preferredStore = undefined;
  activeId = "abc";
  process.env.KROGER_CLIENT_ID = "id";
  process.env.KROGER_CLIENT_SECRET = "secret";
  _resetKrogerTokenCache();
  vi.mocked(getSql).mockReturnValue({ query: vi.fn(async () => stateRow()) } as unknown as ReturnType<typeof getSql>);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
});

const req = (opts: { keys?: string; loc?: string; store?: string | null } = {}) => {
  const q = new URLSearchParams({ loc: opts.loc ?? "abc", keys: opts.keys ?? "almond_milk" });
  if (opts.store !== null) q.set("store", opts.store ?? STORE_BASE.id);
  return new Request(`http://x/api/prices?${q.toString()}`);
};

describe("GET /api/prices: cabeceras", () => {
  it("ok, no_store y pending_sync llevan Cache-Control: private, no-store", async () => {
    preferredStore = { ...STORE_BASE, krogerLocationId: "01400943" };
    installFetch();
    const ok = await GET(req());
    expect(ok.headers.get("Cache-Control")).toBe(NO_STORE);

    preferredStore = { ...STORE_BASE, krogerLocationId: null };
    const none = await GET(req());
    expect(none.headers.get("Cache-Control")).toBe(NO_STORE);

    preferredStore = undefined;
    const pending = await GET(req());
    expect(pending.headers.get("Cache-Control")).toBe(NO_STORE);
  });

  it("errores 400 y 401 también", async () => {
    expect((await GET(req({ loc: "" }))).headers.get("Cache-Control")).toBe(NO_STORE);
    vi.mocked(requireUser).mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    const denied = await GET(req());
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Cache-Control")).toBe(NO_STORE);
  });
});

describe("GET /api/prices: atado a la tienda y a la ubicación", () => {
  it("store distinto de la cuenta: pending_sync sin llamar a Kroger", async () => {
    preferredStore = { ...STORE_BASE, id: "osm:node/2", krogerLocationId: "01400943" };
    installFetch();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pending_sync", retryAfterS: 2, storeId: STORE_BASE.id });
    expect(krogerCalls()).toBe(0);
  });

  it("la cuenta aún no tiene tienda: pending_sync", async () => {
    installFetch();
    const body = await (await GET(req())).json();
    expect(body).toEqual({ status: "pending_sync", retryAfterS: 2, storeId: STORE_BASE.id });
    expect(krogerCalls()).toBe(0);
  });

  it("loc distinto del activo: 400 loc_mismatch sin llamar a Kroger", async () => {
    preferredStore = { ...STORE_BASE, krogerLocationId: "01400943" };
    activeId = "otra";
    installFetch();
    const res = await GET(req({ loc: "abc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "loc_mismatch" });
    expect(krogerCalls()).toBe(0);
  });

  it("sin store en la URL: 400 bad_store", async () => {
    preferredStore = { ...STORE_BASE, krogerLocationId: "01400943" };
    const res = await GET(req({ store: null }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_store" });
  });
});

describe("GET /api/prices", () => {
  it("krogerLocationId null: no_store sin llamar a Locations, con storeId", async () => {
    preferredStore = { ...STORE_BASE, krogerLocationId: null };
    installFetch();
    const res = await GET(req());
    expect(await res.json()).toEqual({ status: "no_store", storeId: STORE_BASE.id });
    expect(urls).toHaveLength(0);
  });

  it("sin krogerLocationId y Locations no encuentra tienda: no_store con checked", async () => {
    preferredStore = { ...STORE_BASE };
    installFetch([]);
    const res = await GET(req());
    expect(await res.json()).toEqual({ status: "no_store", checked: true, storeId: STORE_BASE.id });
    expect(locationsCalls()).toBe(1);
  });

  it("con krogerLocationId: precios en vivo, cache none, storeId y sin Locations", async () => {
    preferredStore = { ...STORE_BASE, krogerLocationId: "01400943" };
    installFetch();
    const body = (await (await GET(req())).json()) as {
      status: string;
      storeId: string;
      cache: string;
      prices: Record<string, unknown>;
    };
    expect(body.status).toBe("ok");
    expect(body.storeId).toBe(STORE_BASE.id);
    expect(body.cache).toBe("none");
    expect(body.prices).toEqual({ almond_milk: { regular: 3.99, size: "64 fl oz", inStore: true } });
    expect(locationsCalls()).toBe(0);
    expect(urls.every((u) => u.includes("/v1/products") || u.includes("/connect/oauth2/token"))).toBe(true);
  });

  it("rechaza más de 60 claves", async () => {
    const keys = Array.from({ length: 61 }, (_, i) => `k${i}`).join(",");
    const res = await GET(req({ keys }));
    expect(res.status).toBe(400);
  });
});
