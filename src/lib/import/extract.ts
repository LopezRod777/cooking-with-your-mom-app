// Server-only: fetches one public link and reads its recipe text. Never import from a client component.
// Pure parsers are exported for tests; the only side effect is the fetch inside extractSource.
import { lookup as lookupCallback, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import type { RecipeSource } from "../schemas";

export type Platform = RecipeSource["platform"];

export type Extracted = {
  platform: Platform;
  url: string;
  title?: string;
  author?: string;
  text?: string;
  image?: string;
  ratingValue?: number;
  ratingCount?: number;
  ok: boolean;
  reason?: string;
};

export type Page = { status: number; finalUrl: string; html: string; cfMitigated: boolean; contentType?: string };

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT = 6000;
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
const clip = (s: string | undefined, max: number): string | undefined =>
  s === undefined ? undefined : s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";

function httpUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s || s.length > 2048) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  deg: "°",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

// Strips tags, decodes entities, collapses whitespace inside lines, keeps line breaks, caps length.
export function cleanText(input: unknown, max = MAX_TEXT): string | undefined {
  if (typeof input !== "string") return undefined;
  const plain = decodeEntities(
    input
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li|div|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  );
  const out = plain
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!out) return undefined;
  return out.length > max ? out.slice(0, max).trimEnd() : out;
}

function cleanLine(input: unknown): string | undefined {
  const t = cleanText(input);
  return t ? t.replace(/\s*\n\s*/g, " ") : undefined;
}

// ---------- URLs

export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Any other explicit scheme (file://, ftp://, gopher://) is refused, not rewritten into an https host.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function detectPlatform(url: string): Platform {
  const host = hostOf(url);
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  return "web";
}

// ---------- SSRF guard: which addresses a server-side fetch may reach

const MAX_REDIRECTS = 4;

function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

// Private, loopback, link-local, multicast and reserved IPv4 ranges.
export function isPrivateIPv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return true; // not a parseable IPv4 literal: refuse
  const [a, b] = p;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    a >= 224 // 224/4 multicast, 240/4 reserved, 255.255.255.255
  );
}

// Expands an IPv6 literal into eight 16-bit groups. Returns null when it cannot be parsed.
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const tail: number[] = [];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = ipv4Parts(v4[1]);
    if (!p) return null;
    tail.push(p[0] * 256 + p[1], p[2] * 256 + p[3]);
    s = s.slice(0, s.length - v4[1].length) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => parseInt(g, 16)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  let groups = halves.length === 2 ? [...head, ...new Array<number>(fill).fill(0), ...rest] : head;
  if (tail.length === 2) groups = [...groups.slice(0, -2), ...tail];
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

// Loopback, unspecified, unique-local, link-local, multicast, and IPv4 embedded in IPv6 (mapped, compat, NAT64).
export function isPrivateIPv6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return true; // unparseable: refuse
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  const compat = g.slice(0, 6).every((x) => x === 0);
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (mapped || compat || nat64) {
    return isPrivateIPv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

// True only when the name resolves and EVERY address it resolves to is public.
export async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0) return false;
    return addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

function youtubeVideoId(url: string): string | null {
  const u = new URL(url);
  let id: string | null | undefined;
  if (u.hostname.toLowerCase() === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else id = u.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(u.pathname)?.[1];
  return id && /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : null;
}

// ---------- Fetch

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  html += decoder.decode();
  return html.slice(0, MAX_BYTES);
}

export class BlockedHostError extends Error {}

// The host check above resolves the name once; the connection resolves it again. This lookup runs for the real
// connection and refuses any private address, so a name that changes its answer in between (DNS rebinding) still
// cannot reach an internal host. Every redirect hop goes through it too.
type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
export function guardedLookup(hostname: string, options: { all?: boolean }, cb: LookupCb): void {
  lookupCallback(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return cb(err, "");
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      return cb(Object.assign(new BlockedHostError(hostname), { code: "EBLOCKED" }), "");
    }
    if (options.all) return cb(null, addresses);
    cb(null, addresses[0].address, addresses[0].family);
  });
}
const guardedAgent = new Agent({ connect: { lookup: guardedLookup as never } });
class TooManyRedirectsError extends Error {}

// Follows redirects by hand so every hop's host is checked before it is contacted.
async function fetchChecked(
  startUrl: string,
  accept: string,
  signal: AbortSignal,
  userAgent = USER_AGENT,
): Promise<{ res: Response; finalUrl: string }> {
  let current = startUrl;
  for (let hop = 0; ; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedHostError("protocol");
    if (u.username !== "" || u.password !== "" || (u.port !== "" && u.port !== "80" && u.port !== "443")) {
      throw new BlockedHostError("port_or_credentials");
    }
    if (!(await isPublicHost(u.hostname))) throw new BlockedHostError(u.hostname);

    // undici's own fetch, so the guarded dispatcher always matches it (Node's built-in fetch may bundle another major).
    const res = (await undiciFetch(current, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": userAgent, "Accept-Language": "en-US", Accept: accept },
      dispatcher: guardedAgent,
    })) as unknown as Response;
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new TooManyRedirectsError();
      current = new URL(location, current).toString();
      continue;
    }
    return { res, finalUrl: current };
  }
}

async function getPage(url: string, accept: string, timeoutMs = TIMEOUT_MS, userAgent = USER_AGENT): Promise<Page> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { res, finalUrl } = await fetchChecked(url, accept, controller.signal, userAgent);
    const html = await readCapped(res);
    return {
      status: res.status,
      finalUrl,
      html,
      cfMitigated: res.headers.get("cf-mitigated") === "challenge",
      contentType: res.headers.get("content-type") ?? undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

// One public HTML page through the same guard (host check per hop, redirects by hand, 2 MB cap). Used by the lookup.
export async function fetchPage(url: string, timeoutMs = TIMEOUT_MS, userAgent = USER_AGENT): Promise<Page> {
  return getPage(url, HTML_ACCEPT, timeoutMs, userAgent);
}

async function getJson(url: string): Promise<Rec | undefined> {
  try {
    const page = await getPage(url, "application/json");
    if (page.status >= 400) return undefined;
    const data = safeJson(page.html);
    return isRecord(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

export function isBlocked(page: Pick<Page, "status" | "cfMitigated" | "html">): boolean {
  return page.status === 403 || page.status === 429 || page.cfMitigated || /<title>\s*Just a moment/i.test(page.html);
}

// ---------- Meta tags and JSON-LD

export function parseOg(html: string): { title?: string; description?: string; image?: string; pageTitle?: string } {
  const meta: Record<string, string> = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = tag[0];
    const key = /\s(?:property|name)=["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase();
    const content = /\scontent=["']([^"']*)["']/i.exec(attrs)?.[1];
    if (key && content !== undefined && !(key in meta)) meta[key] = decodeEntities(content);
  }
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    title: cleanLine(meta["og:title"]),
    description: cleanText(meta["og:description"] ?? meta["description"]),
    image: httpUrl(meta["og:image"]),
    pageTitle: cleanLine(pageTitle),
  };
}

// Finds the balanced {...} starting at openIndex, skipping braces inside JSON strings.
export function extractBalancedObject(src: string, openIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openIndex, i + 1);
    }
  }
  return null;
}

type YouTubePlayer = { title?: string; author?: string; shortDescription?: string };

export function parseYouTubePlayer(html: string): YouTubePlayer | null {
  const marker = "ytInitialPlayerResponse = {";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const json = extractBalancedObject(html, idx + marker.length - 1);
  const data = json ? safeJson(json) : undefined;
  if (!isRecord(data) || !isRecord(data.videoDetails)) return null;
  const d = data.videoDetails;
  return {
    title: cleanLine(d.title),
    author: str(d.author),
    shortDescription: typeof d.shortDescription === "string" ? d.shortDescription : undefined,
  };
}

export function parseYouTubeDescription(html: string): string | undefined {
  return cleanText(parseYouTubePlayer(html)?.shortDescription);
}

export type TikTokData = { author?: string; text?: string; image?: string };

// Reads the rehydration JSON that TikTok embeds in every video page.
export function parseTikTok(html: string): TikTokData | null {
  const m = /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  const data = safeJson(m[1]);
  if (!isRecord(data) || !isRecord(data.__DEFAULT_SCOPE__)) return null;
  const scope = data.__DEFAULT_SCOPE__["webapp.video-detail"];
  const item = isRecord(scope) && isRecord(scope.itemInfo) ? scope.itemInfo.itemStruct : undefined;
  if (!isRecord(item)) return null;
  const author = isRecord(item.author) ? str(item.author.nickname) ?? str(item.author.uniqueId) : undefined;
  const video = isRecord(item.video) ? item.video : {};
  return {
    author: clip(author, 120),
    text: cleanText(item.desc),
    image: httpUrl(video.cover),
  };
}

export type JsonLdRecipe = {
  title?: string;
  author?: string;
  image?: string;
  text?: string;
  ratingValue?: number;
  ratingCount?: number;
};

function collectObjects(value: unknown, out: Rec[], depth = 0): void {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    for (const v of value) collectObjects(v, out, depth + 1);
  } else if (isRecord(value)) {
    out.push(value);
    for (const v of Object.values(value)) collectObjects(v, out, depth + 1);
  }
}

const isRecipeType = (t: unknown) =>
  Array.isArray(t) ? t.some(isRecipeType) : typeof t === "string" && (t === "Recipe" || t.endsWith("/Recipe"));

function namesOf(v: unknown): string | undefined {
  if (Array.isArray(v)) return namesOf(v.find((x) => namesOf(x)));
  if (typeof v === "string") return str(v);
  return isRecord(v) ? str(v.name) : undefined;
}

function imageOf(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    for (const x of v) {
      const found = imageOf(x);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof v === "string") return httpUrl(v);
  if (isRecord(v)) return httpUrl(v.url) ?? httpUrl(v.contentUrl);
  return undefined;
}

// Flattens recipeInstructions: strings, HowToStep, HowToSection (nested itemListElement).
function stepsOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) {
    for (const x of v) stepsOf(x, out);
  } else if (typeof v === "string") {
    const t = cleanText(v);
    if (t) out.push(t);
  } else if (isRecord(v)) {
    if (v.itemListElement !== undefined) stepsOf(v.itemListElement, out);
    else {
      const t = cleanText(typeof v.text === "string" ? v.text : v.name);
      if (t) out.push(t);
    }
  }
  return out;
}

function ratingOf(v: unknown): { ratingValue?: number; ratingCount?: number } {
  const r = Array.isArray(v) ? v.find(isRecord) : v;
  if (!isRecord(r)) return {};
  const value = num(r.ratingValue);
  const count = num(r.ratingCount) ?? num(r.reviewCount);
  return {
    ratingValue: value !== undefined && value >= 0 && value <= 5 ? value : undefined,
    ratingCount: count !== undefined && count >= 0 ? Math.round(count) : undefined,
  };
}

// Finds the schema.org Recipe in any JSON-LD block (arrays, @graph and nested mainEntity included).
export function parseJsonLdRecipe(html: string): JsonLdRecipe | null {
  const nodes: Rec[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const data = safeJson(m[1]);
    if (data !== undefined) collectObjects(data, nodes);
  }
  const recipe = nodes.find((n) => isRecipeType(n["@type"]));
  if (!recipe) return null;

  const ingredients = (Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [])
    .map((i) => cleanLine(i))
    .filter((i): i is string => Boolean(i));
  const steps = stepsOf(recipe.recipeInstructions);
  const parts: string[] = [];
  if (ingredients.length) parts.push("Ingredients:\n" + ingredients.map((i) => `- ${i}`).join("\n"));
  if (steps.length) parts.push("Steps:\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  const text = cleanText(parts.join("\n\n"));

  return {
    title: cleanLine(recipe.name),
    author: namesOf(recipe.author),
    image: imageOf(recipe.image),
    text,
    ...ratingOf(recipe.aggregateRating),
  };
}

// ---------- Platform readers (pure: a Page in, an Extracted out)

function fail(base: { platform: Platform; url: string }, reason: string, extra: Partial<Extracted> = {}): Extracted {
  return { ...base, ...extra, ok: false, reason };
}

export function tiktokFromPage(page: Page, url: string): Extracted {
  const base = { platform: "tiktok" as const, url: page.finalUrl || url };
  if (isBlocked(page)) return fail(base, "blocked");
  if (page.status >= 400) return fail(base, `http_${page.status}`);
  const data = parseTikTok(page.html);
  if (!data) return fail(base, "no_rehydration_data");
  const meta = { author: data.author, image: data.image };
  if (!data.text) return fail(base, "no_text", meta);
  return { ...base, ...meta, text: data.text, ok: true };
}

export function instagramFromPage(page: Page, url: string): Extracted {
  const base = { platform: "instagram" as const, url: page.finalUrl || url };
  if (/\/accounts\/login/i.test(page.finalUrl)) return fail(base, "instagram_needs_text");
  if (isBlocked(page)) return fail(base, "blocked");
  if (page.status >= 400) return fail(base, `http_${page.status}`);
  const og = parseOg(page.html);
  if (!og.description) return fail(base, "instagram_needs_text", { image: og.image });
  const author = /^(.+?) on Instagram/.exec(og.title ?? "")?.[1]?.trim();
  return { ...base, author: clip(author, 120), image: og.image, text: og.description, ok: true };
}

// Lines that look like a recipe: a quantity with a unit, or a numbered step.
const RECIPE_LINE = /\b\d+(\.\d+)?\s*(g|oz|lb|cup|cups|tbsp|tsp|cloves?|eggs?)\b/i;
const NUMBERED_LINE = /^\s*\d+[.)]\s+\S/;
const FALLBACK_MIN_CHARS = 300;
const FALLBACK_MIN_RECIPE_LINES = 3;

// Text a page shows outside JSON-LD: the og:description plus <p> text inside <article> or the
// recipeInstructions block.
export function fallbackText(html: string): string | undefined {
  const regions: string[] = [];
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (article) regions.push(article[1]);
  const at = html.search(/itemprop=["']recipeInstructions["']/i);
  if (at !== -1) regions.push(html.slice(at, at + 20000));
  const paragraphs: string[] = [];
  for (const region of regions) {
    for (const p of region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const t = cleanText(p[1]);
      if (t) paragraphs.push(t);
    }
  }
  const og = parseOg(html).description;
  return cleanText([og, ...paragraphs].filter(Boolean).join("\n\n"));
}

export function looksLikeRecipe(text: string): boolean {
  const lines = text.split("\n").filter((l) => RECIPE_LINE.test(l) || NUMBERED_LINE.test(l));
  return lines.length >= FALLBACK_MIN_RECIPE_LINES;
}

export function webFromPage(page: Page, url: string): Extracted {
  const base = { platform: "web" as const, url: page.finalUrl || url };
  if (isBlocked(page)) return fail(base, "blocked");
  if (page.status >= 400) return fail(base, `http_${page.status}`);
  const ld = parseJsonLdRecipe(page.html);
  if (ld?.text) {
    return {
      ...base,
      title: clip(ld.title, 200),
      author: clip(ld.author, 120),
      image: ld.image,
      text: ld.text,
      ratingValue: ld.ratingValue,
      ratingCount: ld.ratingCount,
      ok: true,
    };
  }
  // No Recipe JSON-LD: use the page's text only when it is a real recipe, not a one-line summary.
  const og = parseOg(page.html);
  const title = clip(ld?.title ?? og.title ?? og.pageTitle, 200);
  const text = fallbackText(page.html);
  if (!text) return fail(base, "no_recipe", { title, image: og.image });
  if (text.length < FALLBACK_MIN_CHARS || !looksLikeRecipe(text)) {
    return fail(base, "web_summary_only", { title, image: og.image });
  }
  return { ...base, title, image: og.image, text, ok: true };
}

export function youtubeFromPage(
  page: Page,
  oembed: Rec | undefined,
  url: string,
): Extracted {
  const base = { platform: "youtube" as const, url };
  if (isBlocked(page)) return fail(base, "blocked");
  const player = parseYouTubePlayer(page.html);
  const meta = {
    title: clip(str(oembed?.title) ?? player?.title, 200),
    author: clip(str(oembed?.author_name) ?? player?.author, 120),
    image: httpUrl(oembed?.thumbnail_url),
  };
  const text = cleanText(player?.shortDescription);
  if (!text) return fail(base, "no_text", meta);
  return { ...base, ...meta, text, ok: true };
}

// ---------- Entry point

export async function extractSource(input: string): Promise<Extracted> {
  const url = normalizeUrl(input);
  if (!url) return { platform: "web", url: input, ok: false, reason: "bad_url" };
  const platform = detectPlatform(url);
  try {
    if (!(await isPublicHost(new URL(url).hostname))) return { platform, url, ok: false, reason: "bad_url" };

    if (platform === "youtube") {
      const id = youtubeVideoId(url);
      if (!id) return { platform, url, ok: false, reason: "bad_url" };
      const canonical = `https://www.youtube.com/watch?v=${id}`;
      const [oembed, page] = await Promise.all([
        getJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`),
        getPage(canonical, HTML_ACCEPT),
      ]);
      return youtubeFromPage(page, oembed, canonical);
    }
    if (platform === "tiktok") return tiktokFromPage(await getPage(url, HTML_ACCEPT), url);
    if (platform === "instagram") return instagramFromPage(await getPage(url, HTML_ACCEPT), url);
    return webFromPage(await getPage(url, HTML_ACCEPT), url);
  } catch (err) {
    const reason =
      err instanceof BlockedHostError
        ? "blocked_host"
        : err instanceof TooManyRedirectsError
          ? "too_many_redirects"
          : err instanceof Error && err.name === "AbortError"
            ? "timeout"
            : "fetch_failed";
    return { platform, url, ok: false, reason };
  }
}
