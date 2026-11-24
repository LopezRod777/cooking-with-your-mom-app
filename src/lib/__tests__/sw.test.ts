// public/sw.js run in a vm with a fake service worker scope: what it answers, what it refuses to touch.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "https://app.test";
type Handler = (event: Record<string, unknown>) => void;

function boot(net: (url: string) => Response | Promise<Response>, file = "../../../public/sw.js") {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (k: string | { url: string }) => new URL(typeof k === "string" ? k : k.url, ORIGIN).href;
  const open = async (name: string) => {
    const m = stores.get(name) ?? stores.set(name, new Map()).get(name)!;
    return {
      match: async (k: string | { url: string }) => m.get(keyOf(k))?.clone(),
      put: async (k: string | { url: string }, r: Response) => void m.set(keyOf(k), r),
    };
  };
  const handlers = new Map<string, Handler>();
  const fetched: string[] = [];
  let left = 0;
  const sandbox = {
    self: { location: { origin: ORIGIN }, addEventListener: (t: string, h: Handler) => handlers.set(t, h), skipWaiting() {}, clients: { claim: async () => {} }, registration: { unregister: async () => { left++; } } },
    caches: { open, match: async (k: string | { url: string }, o?: { cacheName: string }) => (o ? [stores.get(o.cacheName)] : [...stores.values()]).map((m) => m?.get(keyOf(k))).find(Boolean)?.clone(), has: async (n: string) => stores.has(n), keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) },
    fetch: async (req: string | { url: string }) => {
      const url = keyOf(req);
      fetched.push(url.replace(ORIGIN, ""));
      return net(url.replace(ORIGIN, ""));
    },
    Response, URL, TextEncoder, crypto, Uint8Array, Set, Error,
  };
  vm.runInNewContext(readFileSync(resolve(__dirname, file), "utf8"), sandbox);
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let answer: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    handlers.get(type)!({ ...event, respondWith: (p: Promise<Response>) => { answer = p; }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    return answer;
  };
  const request = (path: string, init: { mode?: string; destination?: string; method?: string; range?: string } = {}) => ({
    url: new URL(path, ORIGIN).href, method: init.method ?? "GET", mode: init.mode ?? "cors", destination: init.destination ?? "",
    headers: { get: (h: string) => (h === "range" ? (init.range ?? null) : null) },
  });
  const ask = (path: string, init = {}) => dispatch("fetch", { request: request(path, init) });
  return { dispatch, ask, stores, fetched, open, left: () => left };
}

const files: Record<string, string> = {
  "/offline": '<script src="/_next/static/chunks/a.js"></script><script>x="[\\"static/chunks/b.js\\"]"</script><link href="/_next/static/chunks/c.css">',
  "/media/kitchen-hands.jpg": "hands", "/_next/static/chunks/a.js": "a", "/_next/static/chunks/b.js": "b",
  "/_next/static/chunks/c.css": "@font-face{src:url(../media/f.woff2)} .n{background:url(\"data:image/svg+xml,%3Crect filter='url(%23n)'/%3E\")}", "/_next/static/media/f.woff2": "f",
};
let up = true;
const net = (url: string) => {
  if (!up) throw new TypeError("offline");
  if (url.includes("%23")) return new Response("", { status: 404 });
  return url in files ? new Response(files[url]) : new Response("live " + url);
};
beforeEach(() => { up = true; });

describe("service worker", () => {
  it("keeps the shell with every build file it mentions, fonts inside the css included", async () => {
    const sw = boot(net);
    await sw.dispatch("install", {});
    const shell = [...sw.stores.keys()].find((k) => k.startsWith("cwym-shell-"))!;
    expect([...sw.stores.get(shell)!.keys()].map((k) => k.replace(ORIGIN, "")).sort()).toEqual(Object.keys(files).sort());
  });

  it("with signal a page comes from the network; without, from the shell", async () => {
    const sw = boot(net);
    await sw.dispatch("install", {});
    expect(await (await sw.ask("/recipe/x", { mode: "navigate" }))!.text()).toBe("live /recipe/x");
    up = false;
    expect(await (await sw.ask("/recipe/x", { mode: "navigate" }))!.text()).toBe(files["/offline"]);
    expect(await (await sw.ask("/_next/static/chunks/b.js"))!.text()).toBe("b");
    expect(await (await sw.ask("/_next/image?url=%2Fmedia%2Fkitchen-hands.jpg&w=1200&q=75", { destination: "image" }))!.text()).toBe("hands");
    await expect(sw.ask("/_next/image?url=%2Fmedia%2Fother.jpg&w=1200&q=75", { destination: "image" })).rejects.toThrow("offline");
  });

  it("no signed-in page is ever stored", async () => {
    const sw = boot(net);
    await sw.dispatch("install", {});
    await sw.ask("/", { mode: "navigate" });
    const keys = [...sw.stores.values()].flatMap((m) => [...m.keys()]);
    expect(keys.some((k) => k === ORIGIN + "/")).toBe(false);
  });

  it("never answers for /api, writes, other pages' data or other origins' scripts", async () => {
    const sw = boot(net);
    expect(await sw.ask("/api/state")).toBeUndefined();
    expect(await sw.ask("/api/state", { mode: "navigate" })).toBeUndefined();
    expect(await sw.ask("/shop", { method: "POST" })).toBeUndefined();
    expect(await sw.ask("/shop?_rsc=1")).toBeUndefined();
    expect(await sw.ask("https://clerk.test/clerk.js", { destination: "script" })).toBeUndefined();
  });

  it("a half-downloaded new shell does not replace the old one", async () => {
    const sw = boot(net);
    await sw.dispatch("install", {});
    const before = [...sw.stores.get("cwym-meta")!.values()];
    const old = files["/offline"];
    files["/offline"] = old + "<!-- v2 --><script src=\"/_next/static/chunks/gone.js\">";
    const port: unknown[] = [];
    const broken = boot((u) => (u === "/_next/static/chunks/gone.js" ? new Response("", { status: 404 }) : net(u)));
    await broken.dispatch("message", { data: { type: "refresh-shell" }, ports: [{ postMessage: (m: unknown) => port.push(m) }] });
    files["/offline"] = old;
    expect(port).toEqual(["failed"]);
    expect(broken.stores.get("cwym-meta")?.size ?? 0).toBe(0);
    expect(before).toHaveLength(1);
  });

  it("saved clips answer byte ranges with 206, whole files with 200, the rest goes to the network", async () => {
    const sw = boot(net);
    await (await sw.open("cwym-media-v1")).put("/media/clips/sear.mp4", new Response("0123456789", { headers: { "content-type": "video/mp4" } }));
    const part = await (await sw.ask("/media/clips/sear.mp4", { destination: "video", range: "bytes=2-4" }))!;
    expect([part.status, part.headers.get("content-range"), await part.text()]).toEqual([206, "bytes 2-4/10", "234"]);
    const tail = await (await sw.ask("/media/clips/sear.mp4", { destination: "video", range: "bytes=-3" }))!;
    expect(await tail.text()).toBe("789");
    const probe = await (await sw.ask("/media/clips/sear.mp4", { destination: "video", range: "bytes=0-1" }))!;
    expect(probe.headers.get("content-length")).toBe("2");
    expect((await (await sw.ask("/media/clips/sear.mp4", { destination: "video", range: "bytes=50-60" }))!).status).toBe(416);
    expect((await (await sw.ask("/media/clips/sear.mp4", { destination: "video" }))!).status).toBe(200);
    expect(await (await sw.ask("/media/x.jpg", { destination: "image" }))!.text()).toBe("live /media/x.jpg");
  });

  it("the same with Vercel's paths (static/immutable), fonts included", async () => {
    const moved = Object.fromEntries(Object.entries(files).map(([k, v]) => [k.replace("/static/", "/static/immutable/"), v.replaceAll("static/chunks", "static/immutable/chunks")]));
    const sw = boot((u) => (u in moved ? new Response(moved[u]) : new Response("", { status: 404 })));
    await sw.dispatch("install", {});
    const shell = [...sw.stores.keys()].find((k) => k.startsWith("cwym-shell-"))!;
    expect([...sw.stores.get(shell)!.keys()].map((k) => k.replace(ORIGIN, "")).sort()).toEqual(Object.keys(moved).sort());
  });

  const refresh = (sw: ReturnType<typeof boot>) => sw.dispatch("message", { data: { type: "refresh-shell" }, ports: [] });
  const shells = (sw: ReturnType<typeof boot>) => [...sw.stores.keys()].filter((k) => k.startsWith("cwym-shell-"));
  const pointer = async (sw: ReturnType<typeof boot>) => (await (await sw.open("cwym-meta")).match("/__cwym-shell"))!.text();

  it("several refreshes at once during a deploy download one shell, whole", async () => {
    let n = 0;
    const sw = boot((u) => (u === "/offline" ? new Response(files["/offline"] + `<!-- build ${n++} -->`) : net(u)));
    await Promise.all([sw.dispatch("install", {}), refresh(sw), refresh(sw)]);
    expect(shells(sw)).toEqual([await pointer(sw)]);
    expect(sw.stores.get(shells(sw)[0])!.size).toBe(Object.keys(files).length);
  });

  it("a café sign-in page that answers 200 to everything does not replace the shell", async () => {
    let cafe = false;
    const page = () => new Response("<html>Wi-Fi</html>", { headers: { "content-type": "text/html" } });
    const sw = boot((u) => (cafe ? page() : net(u)));
    await sw.dispatch("install", {});
    const before = await pointer(sw);
    cafe = true;
    await refresh(sw);
    expect(await pointer(sw)).toBe(before);
    const half = boot((u) => (u === "/offline" ? net(u) : page()));
    await half.dispatch("install", {});
    expect(shells(half)).toEqual([]);
    const other = boot((u) => (u === "/offline" ? page() : net(u)));
    await other.dispatch("install", {});
    expect(shells(other)).toEqual([]);
  });

  it("a failed download leaves nothing half done behind", async () => {
    const sw = boot((u) => (u.endsWith("c.css") ? new Response("", { status: 404 }) : net(u)));
    await sw.dispatch("install", {});
    expect(shells(sw)).toEqual([]);
  });

  it("after a deploy a tab on the previous build still gets its files; two builds at most are kept", async () => {
    let html = files["/offline"];
    const sw = boot((u) => (u === "/offline" ? new Response(html) : u.includes("chunks/a.js") && html.includes("v2") ? new Response("", { status: 404 }) : net(u)));
    await sw.dispatch("install", {});
    html = '<script src="/_next/static/chunks/b.js"></script><!-- v2 -->';
    await refresh(sw);
    expect(await (await sw.ask("/_next/static/chunks/a.js"))!.text()).toBe("a");
    html += "<!-- v3 -->";
    await refresh(sw);
    expect(shells(sw)).toHaveLength(2);
  });

  it("the retired version deletes everything, unregisters and answers nothing", async () => {
    const sw = boot(net, "../../../scripts/sw-retire.js");
    for (const n of ["cwym-meta", "cwym-shell-x", "cwym-media-v1", "someone-else"]) await sw.open(n);
    await sw.dispatch("activate", {});
    expect([[...sw.stores.keys()], sw.left()]).toEqual([["someone-else"], 1]);
    await expect(sw.ask("/")).rejects.toThrow();
  });
});
