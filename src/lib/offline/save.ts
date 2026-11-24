import { categoryImageFor, publicImageFor } from "../images/pick";
import type { AppState, Recipe } from "../schemas";
import { stepActionFor } from "../stepAction";
import { MEDIA_CACHE, mediaOwner } from "../store";

// `photos`: the week's dishes, the favorites' and the step photos that exist. `clips`: cook-mode loops the week uses.
// `extra`: photos on other people's sites, which may refuse; they never hold back "Saved".
export type WeekMedia = { photos: string[]; clips: string[]; extra: string[] };

const isOurs = (url: string) => url.startsWith("/") || /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(url);

export function weekMedia(state: Pick<AppState, "plan" | "favoriteRecipes" | "profile">): WeekMedia {
  const planned = Object.values(state.plan?.recipes ?? {});
  const photos = new Set<string>();
  const extra = new Set<string>();
  const clips = new Set<string>();
  const add = (url: string) => (isOurs(url) ? photos : extra).add(url);
  for (const r of [...planned, ...Object.values(state.favoriteRecipes)] as Recipe[]) {
    const dish = publicImageFor(r);
    if (dish !== categoryImageFor(r)) add(dish);
    if (state.profile.skill === "beginner") for (const s of r.steps) if (s.imageUrl) add(s.imageUrl);
  }
  for (const r of planned) {
    for (const action of [...r.steps.map((s) => stepActionFor(s)), "rest"]) {
      clips.add(`/media/clips/${action}.mp4`);
      clips.add(`/media/clips/${action}.jpg`);
    }
  }
  return { photos: [...photos], clips: [...clips], extra: [...extra] };
}

async function missing(cache: Cache, urls: string[]): Promise<string[]> {
  const hits = await Promise.all(urls.map((u) => cache.match(u)));
  return urls.filter((_, i) => !hits[i]);
}

async function fetchOne(cache: Cache, url: string, ours: boolean, still: () => boolean): Promise<boolean> {
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    // A café sign-in page answers 200 with HTML.
    if (!res.ok || /html/.test(res.headers.get("content-type") ?? "") || !still()) return false;
    await cache.put(url, res);
    return true;
  } catch {
    if (ours) return false;
    try {
      const res = await fetch(url, { mode: "no-cors", credentials: "omit" });
      if (still()) await cache.put(url, res);
    } catch {
      // Best effort: that site does not let its photo be kept.
    }
    return true;
  }
}

// Downloads what is not here yet, four at a time. Returns how many of our own files did not make it.
// Stops if the person signs out meanwhile.
async function fill(urls: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const who = mediaOwner();
  if (!who) return urls.length;
  const still = () => mediaOwner() === who;
  const cache = await caches.open(MEDIA_CACHE);
  const todo = await missing(cache, urls);
  let done = 0;
  let failed = 0;
  onProgress?.(0, todo.length);
  const worker = async () => {
    for (let url = todo.shift(); url !== undefined; url = todo.shift()) {
      if (!still()) return;
      const ours = isOurs(url);
      if (!(await fetchOne(cache, url, ours, still)) && ours) failed++;
      done++;
      onProgress?.(done, done + todo.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return failed;
}

// What the cache really holds, never a flag.
export async function isWeekSaved(media: WeekMedia): Promise<boolean> {
  if (typeof caches === "undefined" || !(await caches.has(MEDIA_CACHE))) return false;
  const cache = await caches.open(MEDIA_CACHE);
  return (await missing(cache, [...media.photos, ...media.clips])).length === 0;
}

// Photos of weeks that are gone leave the phone.
async function prune(media: WeekMedia): Promise<void> {
  if (!mediaOwner()) return;
  const keep = new Set([...media.photos, ...media.clips, ...media.extra].map((u) => new URL(u, location.origin).href));
  const cache = await caches.open(MEDIA_CACHE);
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

// Quietly, on every visit with signal: the week's photos (about 3 MB), not the clips.
export async function savePhotos(media: WeekMedia): Promise<void> {
  if (typeof caches === "undefined") return;
  await prune(media);
  await fill([...media.photos, ...media.extra]);
}

// The shell has to be in place too: without it nothing opens.
async function shellReady(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
  if (!reg?.active) return false;
  const { port1, port2 } = new MessageChannel();
  const answer = new Promise<unknown>((r) => {
    port1.onmessage = (e) => r(e.data);
    setTimeout(() => r("timeout"), 20000);
  });
  reg.active.postMessage({ type: "refresh-shell" }, [port2]);
  return (await answer) === "ok";
}

export async function saveWeek(media: WeekMedia, onProgress: (done: number, total: number) => void): Promise<boolean> {
  await navigator.storage?.persist?.().catch(() => false);
  const shell = await shellReady();
  await prune(media); // first: a full phone needs the room
  const failed = await fill([...media.photos, ...media.clips, ...media.extra], onProgress);
  return shell && failed === 0 && (await isWeekSaved(media));
}
