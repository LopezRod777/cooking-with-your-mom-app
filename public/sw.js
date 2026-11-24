// Cooking with your Mom without signal (docs/plans/2026-11-24-sin-internet.md). No dependencies.
// Keeps two things: the /offline shell (one public page with no account data, plus the scripts it needs) and the
// photos and clips the week page saved. Never touches /api and never stores a signed-in page.
// To retire it: copy scripts/sw-retire.js over this file and deploy.
const META = "cwym-meta"; // which shell cache is current
const SHELL_PREFIX = "cwym-shell-";
const MEDIA = "cwym-media-v1"; // same name in src/lib/store.ts
const POINTER = "/__cwym-shell";
// The one fixed photo the no-signal screens use (empty Favorites, no plan yet), asked through /_next/image at any size.
const FIXED_PHOTO = "/media/kitchen-hands.jpg";

async function currentShell() {
  const meta = await caches.open(META);
  const hit = await meta.match(POINTER);
  return hit ? hit.text() : null;
}

// Every build file the text mentions (on Vercel they live under static/immutable/), with or without the /_next/ prefix (the flight data leaves it out).
function staticUrls(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:\/_next\/)?static\/(?:immutable\/)?(?:chunks|media|css)\/[A-Za-z0-9_~.\-/%]+(?:\?[A-Za-z0-9_=&.\-]+)?/g)) {
    out.add(m[0].startsWith("/_next/") ? m[0] : `/_next/${m[0]}`);
  }
  return out;
}

// One download at a time, also between an old worker and the one replacing it: two builds must never mix.
let refreshing = null;
function refreshShell() {
  refreshing ??= (self.navigator?.locks ? self.navigator.locks.request("cwym-shell", downloadShell) : downloadShell()).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Downloads the shell into a cache of its own and switches to it only when every file landed.
async function downloadShell() {
  const res = await fetch("/offline", { cache: "no-store", credentials: "omit" });
  if (!res.ok || res.redirected) throw new Error(`shell ${res.status}`);
  const html = await res.text();
  // A hotel or café sign-in page answers 200 to anything: the real one mentions its build files.
  if (staticUrls(html).size === 0) throw new Error("not the shell");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
  const name = SHELL_PREFIX + [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if ((await currentShell()) === name && (await caches.has(name))) return;
  try {
    await fillShell(await caches.open(name), html);
  } catch (err) {
    if ((await currentShell()) !== name) await caches.delete(name);
    throw err;
  }
  // The previous build stays too: a tab opened before the deploy may still ask for its files.
  const previous = await currentShell();
  await (await caches.open(META)).put(POINTER, new Response(name));
  for (const key of await caches.keys()) if (key.startsWith(SHELL_PREFIX) && key !== name && key !== previous) await caches.delete(key);
}

async function fillShell(cache, html) {
  const queue = [...staticUrls(html), FIXED_PHOTO];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const url = queue.shift();
    const asset = await fetch(url);
    if (!asset.ok || /html/.test(asset.headers.get("content-type") ?? "")) throw new Error(`shell asset ${asset.status}`);
    await cache.put(url, asset.clone());
    // Only the fonts: a filter reference inside a data: image, url(%23n), looks like a file too.
    if (/\.css(\?|$)/.test(url)) {
      for (const m of (await asset.text()).matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const u = new URL(m[1], new URL(url, self.location.origin));
        const path = u.pathname + u.search;
        if (u.origin === self.location.origin && /^\/_next\/static\/(?:immutable\/)?media\//.test(path) && !seen.has(path)) {
          seen.add(path);
          queue.push(path);
        }
      }
    }
  }
  await cache.put("/offline", new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
}

async function fromShell(request) {
  const name = await currentShell();
  return name ? caches.match(request, { cacheName: name }) : undefined;
}

// Build files carry their content in the name, so any kept build may answer.
async function buildFile(request) {
  return (await fromShell(request)) || (await caches.match(request)) || fetch(request);
}

async function navigate(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const shell = await fromShell("/offline");
    if (shell) return shell;
    throw err;
  }
}

// Safari asks for video in byte ranges and refuses a plain 200.
async function ranged(request, response) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!m || (!m[1] && !m[2]) || response.type === "opaque") return response;
  const body = await response.arrayBuffer();
  const size = body.byteLength;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
    },
  });
}

async function media(request) {
  // match with a cache name, not open: open would create it again after sign out.
  const hit = await caches.match(request.url, { cacheName: MEDIA });
  if (hit) return ranged(request, hit);
  try {
    return await fetch(request);
  } catch (err) {
    const photo = request.url.includes(encodeURIComponent(FIXED_PHOTO)) && (await fromShell(FIXED_PHOTO));
    if (photo) return photo;
    throw err;
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // A failed first download is not fatal: every page load online asks again.
  event.waitUntil(refreshShell().catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "refresh-shell") return;
  event.waitUntil(refreshShell().then(() => event.ports[0]?.postMessage("ok"), () => event.ports[0]?.postMessage("failed")));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const own = url.origin === self.location.origin;
  if (own && url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    if (own) event.respondWith(navigate(request));
    return;
  }
  if (own && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(buildFile(request));
    return;
  }
  if (request.destination === "image" || request.destination === "video") event.respondWith(media(request));
});
