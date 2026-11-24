import { documentAccount } from "./auth/account";
import { AppState, DEFAULT_STATE, STATE_SCHEMA_TAG, type Pet, type Places, type SavedLocation } from "./schemas";

// Per-account app state with a local cache and server sync (see docs/PLAN-CUENTAS.md).
//
// Identity comes from Clerk (setIdentity). Each account has its own localStorage key.
// The module-level copy is cleared whenever the identity changes, so one browser can
// serve two accounts without leaking state between them.
//
// Server contract (/api/state): GET -> {revision, state|null}; PUT {baseRevision, state}
// -> 200 {revision} or 409 {revision, state} (someone else wrote first). No automatic merge:
// a 409 becomes a conflict the person resolves ("use theirs" / "keep mine").

export const LEGACY_KEY = "cwym:v1"; // pre-accounts cache, unowned; only ever offered for migration
export const LEGACY_BACKUP_PREFIX = "cwym:v1:legacy-";
export const CACHE_PREFIX = "cwym:v2:u:";
export const BACKUP_PREFIX = "cwym:v2:backup:";
// The last account Clerk confirmed on this device: whose cache the no-signal screens (/offline) may open.
export const LAST_USER_KEY = "cwym:last-user";
// Cache Storage with the week's photos and clips (src/lib/offline/save.ts, public/sw.js).
export const MEDIA_CACHE = "cwym-media-v1";
export const STATE_URL = "/api/state";
export const PUSH_DEBOUNCE_MS = 1500;

export type SyncStatus = "idle" | "loading" | "synced" | "saving" | "offline" | "conflict" | "error";

// `local`: the other version is another tab's on this same device, not the server's.
export type Conflict = { revision: number; state: AppState; local?: true };
export type MigrationOffer = { legacy: AppState };

export type StoreSnapshot = {
  state: AppState;
  hydrated: boolean;
  saveError: string | null;
  recoveredFrom: string | null;
  sync: {
    status: SyncStatus;
    revision: number;
    dirty: boolean;
    conflict: Conflict | null;
    migration: MigrationOffer | null;
    lastError: string | null;
  };
};

// `sent`: fingerprint of the last body this device PUT (see `stable`). If the server later holds exactly that
// content under a newer revision, the write landed and only its answer was lost; no conflict.
// `edits`: the last edit of each tab this copy includes, so a tab can tell whether a newer copy on disk has its own.
type Edits = Record<string, number>;
type Cache = { revision: number; state: AppState; dirty: boolean; legacy: Legacy; sent: string | null; edits: Edits };

// What a cache lacked before schema 2 (schema, pets, places, restrictions), before schema 4 (drinks budget) or before schema 5 (kitchen), read from the raw JSON before AppState fills defaults.
type Legacy = { schema: boolean; pets: boolean; places: boolean; petRestrictions: Set<string>; drinksBudget: boolean; kitchen: boolean };
const NO_LEGACY: Legacy = { schema: false, pets: false, places: false, petRestrictions: new Set(), drinksBudget: false, kitchen: false };

function legacyOf(raw: Record<string, unknown>): Legacy {
  const pets = Array.isArray(raw.pets) ? raw.pets : [];
  const petRestrictions = new Set<string>();
  for (const p of pets) {
    if (typeof p !== "object" || p === null || "restrictions" in p) continue;
    const id = (p as { id?: unknown }).id;
    if (typeof id === "string") petRestrictions.add(id);
  }
  // Schemas 2 to 5 are current for pets and places; only a cache older than 2 needs adoption.
  const profile = raw.profile;
  const drinksBudget = typeof profile === "object" && profile !== null && !("drinksBudgetUsd" in profile);
  const kitchen = typeof profile === "object" && profile !== null && !("kitchen" in profile);
  return {
    schema: raw.schema !== 2 && raw.schema !== 3 && raw.schema !== 4 && raw.schema !== 5 && raw.schema !== 6 && raw.schema !== 7 && raw.schema !== 8 && raw.schema !== 9 && raw.schema !== 10 && raw.schema !== 11,
    pets: !("pets" in raw),
    places: !("places" in raw),
    petRestrictions,
    drinksBudget,
    kitchen,
  };
}

function isLegacy(l: Legacy): boolean {
  return l.schema || l.pets || l.places || l.petRestrictions.size > 0 || l.drinksBudget || l.kitchen;
}

// The JSON form of Legacy, stored in the cache record while the legacy flags are still pending.
type LegacyRecord = { schema: boolean; pets: boolean; places: boolean; petRestrictions: string[]; drinksBudget: boolean; kitchen: boolean };

function legacyRecordOf(l: Legacy): LegacyRecord {
  return {
    schema: l.schema,
    pets: l.pets,
    places: l.places,
    petRestrictions: [...l.petRestrictions],
    drinksBudget: l.drinksBudget,
    kitchen: l.kitchen,
  };
}

function readLegacyRecord(data: unknown): Legacy | null {
  if (typeof data !== "object" || data === null) return null;
  const { schema, pets, places, petRestrictions, drinksBudget, kitchen } = data as Record<string, unknown>;
  if (typeof schema !== "boolean" || typeof pets !== "boolean" || typeof places !== "boolean") return null;
  if (!Array.isArray(petRestrictions)) return null;
  const ids = petRestrictions.filter((x): x is string => typeof x === "string");
  // A record without the drinks flag was written before schema 4, so the budget is still missing from it. Same for kitchen and schema 5.
  return { schema, pets, places, petRestrictions: new Set(ids), drinksBudget: drinksBudget !== false, kitchen: kitchen !== false };
}

// A flag is set if either the raw state or the stored record says the data was missing.
function unionLegacy(a: Legacy, b: Legacy | null): Legacy {
  if (!b) return a;
  return {
    schema: a.schema || b.schema,
    pets: a.pets || b.pets,
    places: a.places || b.places,
    petRestrictions: new Set([...a.petRestrictions, ...b.petRestrictions]),
    drinksBudget: a.drinksBudget || b.drinksBudget,
    kitchen: a.kitchen || b.kitchen,
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | null = null;
const RETRY_READ_MS = 1200;
let timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = { setTimeout, clearTimeout };

// Tests inject fetch and timers. The app uses the globals.
export function configureStore(opts: { fetch?: FetchLike; timers?: typeof timers }) {
  if (opts.fetch) fetchImpl = opts.fetch;
  if (opts.timers) timers = opts.timers;
}

// ---- module state ----------------------------------------------------------

let userId: string | null = null;
let generation = 0; // bumps on identity change; late responses from an old identity are dropped
let current: AppState = DEFAULT_STATE;
let revision = 0;
let dirty = false;
let hydrated = false;
let status: SyncStatus = "idle";
let conflict: Conflict | null = null;
let migration: MigrationOffer | null = null;
let lastError: string | null = null;
let lastSaveError: string | null = null;
let recoveredFrom: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let changedDuringFlight = false;
let listenersBound = false;
// True while `current` came from a cache written before schema 2. Its pets and places are defaults,
// not the account's real data, so it must not be pushed until the server's fields are adopted.
let legacyPending = false;
// True in the no-signal screens: the identity comes from this device, not from Clerk, so nothing may reach the server
// (the cookie could belong to another account). Edits wait in the cache; the real app pushes them.
let offlineOnly = false;
// The raw cache record this tab last wrote or took, to notice another tab's newer one without parsing.
let lastDisk: string | null = null;
// After sign out: an answer still in flight must not write the copy back.
let forgotten = false;
let tab = ""; // made on first use: prerendering forbids random values
const tabId = () => (tab ||= randomId(8));
let edits: Edits = {};
// The last whole state handed to setAppState: callers hand the same one to saveState right after.
let lastWhole: AppState | null = null;
// Fingerprint of the last body PUT from this device (survives reloads through the cache).
let lastSent: string | null = null;
let legacy: Legacy = NO_LEGACY;

function clearLegacy() {
  legacyPending = false;
  legacy = NO_LEGACY;
}
const listeners = new Set<() => void>();

const SERVER_SNAPSHOT: StoreSnapshot = {
  state: DEFAULT_STATE,
  hydrated: false,
  saveError: null,
  recoveredFrom: null,
  sync: { status: "idle", revision: 0, dirty: false, conflict: null, migration: null, lastError: null },
};
let snapshot: StoreSnapshot = SERVER_SNAPSHOT;

function publish() {
  snapshot = {
    state: current,
    hydrated,
    saveError: lastSaveError,
    recoveredFrom,
    sync: { status, revision, dirty, conflict, migration, lastError },
  };
  for (const listener of listeners) listener();
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---- parsing ---------------------------------------------------------------

export function migrate(raw: unknown): unknown {
  const version = typeof raw === "object" && raw !== null ? (raw as { version?: unknown }).version : undefined;
  // Accounts with a plan from before firstPlannedAt existed: their first plan is the day they started, so no new "Plan again" gets a grace day.
  let data = raw;
  if (typeof raw === "object" && raw !== null) {
    const { plan, firstPlannedAt } = raw as { plan?: unknown; firstPlannedAt?: unknown };
    if (typeof plan === "object" && plan !== null && typeof (plan as { createdAt?: unknown }).createdAt === "string" && (firstPlannedAt === undefined || firstPlannedAt === null)) {
      data = { ...raw, firstPlannedAt: (plan as { createdAt: string }).createdAt };
    }
  }
  switch (version) {
    case 1:
      return data;
    default:
      // Future schema versions get their own case here, before parsing.
      return data;
  }
}

function parseState(data: unknown): AppState | null {
  const parsed = AppState.safeParse(migrate(data));
  return parsed.success ? parsed.data : null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// `sent` is the JSON of the state it fingerprints. One written under an older schema is read through the current one,
// as the server copy is, or a schema bump would make a write that landed look like someone else's.
function upgradeSent(sent: string): string {
  const state = parseState(parseJson(sent));
  return state ? fingerprint(state) : sent;
}

function parseCache(raw: string): Cache | null {
  const data = parseJson(raw);
  if (typeof data !== "object" || data === null) return null;
  const { revision: r, state: s, dirty: d, legacy: l, sent, edits: e } = data as {
    edits?: unknown;
    revision?: unknown;
    state?: unknown;
    dirty?: unknown;
    legacy?: unknown;
    sent?: unknown;
  };
  const state = parseState(s);
  if (!state || typeof r !== "number" || !Number.isInteger(r) || r < 0) return null;
  // Read before parsing: AppState fills missing fields with defaults, which are indistinguishable from real data.
  // The stored record covers the case where the state was already rewritten with those defaults.
  const legacyFlags = unionLegacy(legacyOf(s as Record<string, unknown>), readLegacyRecord(l));
  const tabs = typeof e === "object" && e !== null ? Object.entries(e).filter((x): x is [string, number] => typeof x[1] === "number") : [];
  return { revision: r, state, dirty: d === true, legacy: legacyFlags, sent: typeof sent === "string" ? upgradeSent(sent) : null, edits: Object.fromEntries(tabs) };
}

// ---- local cache -----------------------------------------------------------

function cacheKey(id: string): string {
  return CACHE_PREFIX + id;
}

function keysWithPrefix(s: Storage, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

// Keeps one backup of an unreadable cache under the account's backup prefix. Returns its timestamp.
function keepCorruptBackup(s: Storage, id: string, raw: string): string | null {
  const prefix = BACKUP_PREFIX + id + ":";
  try {
    const existing = keysWithPrefix(s, prefix).find((k) => s.getItem(k) === raw);
    if (existing) return existing.slice(prefix.length);
    for (const key of keysWithPrefix(s, prefix)) s.removeItem(key);
    const stamp = new Date().toISOString();
    s.setItem(prefix + stamp, raw);
    return stamp;
  } catch {
    return null;
  }
}

function readCache(id: string): Cache | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(cacheKey(id));
  if (raw === null) return null;
  const cache = parseCache(raw);
  if (cache) {
    recoveredFrom = null;
    lastDisk = raw;
    return cache;
  }
  recoveredFrom = keepCorruptBackup(s, id, raw);
  return null;
}

const TAB_COPY = "cwym:tab-copy";

// This tab was reloaded before choosing between its version and another tab's: the choice comes back.
function takeTabCopy(id: string, cached: Cache): boolean {
  const s = storage();
  let left: Cache | null = null;
  try {
    const key = window.sessionStorage?.getItem(TAB_COPY) ?? null;
    if (!s || !key?.startsWith(`${BACKUP_PREFIX}${id}:tab-`)) return false;
    const raw = s.getItem(key);
    left = raw !== null ? parseCache(raw) : null;
    s.removeItem(key);
    window.sessionStorage.removeItem(TAB_COPY);
  } catch {
    return false;
  }
  if (!left || sameState(left.state, cached.state)) return false;
  loadCache(left);
  countEdit();
  dirty = true;
  conflict = { revision: cached.revision, state: cached.state, local: true };
  hydrated = true;
  status = "conflict";
  writeCache();
  publish();
  return true;
}

const tabCopyKey = (id: string) => `${BACKUP_PREFIX}${id}:tab-${tabId()}`;

function writeCache(): boolean {
  const s = storage();
  if (!s || !userId || forgotten) return false;
  let error: string | null = null;
  const record: Omit<Cache, "legacy"> & { legacy?: LegacyRecord } = { revision, state: current, dirty, sent: lastSent, edits };
  // Kept until adoption completes: the state written from defaults no longer shows what it lacked.
  if (legacyPending) record.legacy = legacyRecordOf(legacy);
  try {
    const raw = JSON.stringify(record);
    if (conflict?.local) {
      // Both versions stay until the person chooses: the other tab's in the cache, this one's beside it.
      s.setItem(tabCopyKey(userId), raw);
      window.sessionStorage?.setItem(TAB_COPY, tabCopyKey(userId)); // a reload asks again (takeTabCopy)
    } else {
      s.setItem(cacheKey(userId), raw);
      lastDisk = raw;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "save failed";
  }
  if (error !== lastSaveError) {
    lastSaveError = error;
    publish();
  }
  return error === null;
}

// Another tab of this account (or the no-signal screens) wrote the cache. Every edit is written there on the spot, so
// the disk copy is the newest one: take it, or this tab's next write would erase it. If it lacks an unsent edit of this
// tab (both edited at the same instant), neither version may win in silence: a conflict. Returns true when it changed.
function adoptDisk(): boolean {
  const s = storage();
  if (!s || !userId || conflict?.local || migration || legacyPending) return false;
  const raw = s.getItem(cacheKey(userId));
  if (raw === null || raw === lastDisk) return false;
  const disk = parseCache(raw);
  if (!disk || isLegacy(disk.legacy)) return false;
  lastDisk = raw;
  if (dirty && (disk.edits[tabId()] ?? 0) < (edits[tabId()] ?? 0) && !sameState(disk.state, current)) {
    conflict = { revision: disk.revision, state: disk.state, local: true };
    status = "conflict";
    writeCache();
    publish();
    return false;
  }
  if (conflict && disk.revision >= conflict.revision) {
    conflict = null; // already decided in the other tab
    status = offlineOnly ? "offline" : "synced";
  }
  if (inFlight) changedDuringFlight = true;
  loadCache(disk);
  publish();
  return true;
}

function loadCache(cache: Cache): void {
  current = cache.state;
  revision = cache.revision;
  dirty = cache.dirty;
  lastSent = cache.sent;
  edits = cache.edits;
}

// Counts an edit of this tab. Tabs that closed long ago drop out.
function countEdit(): void {
  const { [tabId()]: mine = 0, ...others } = edits;
  edits = { ...Object.fromEntries(Object.entries(others).slice(-12)), [tabId()]: mine + 1 };
}

export function rememberUser(id: string | null): void {
  const s = storage();
  try {
    if (id) s?.setItem(LAST_USER_KEY, id);
    else s?.removeItem(LAST_USER_KEY);
  } catch {
    // Storage can be blocked: without it there are no no-signal screens either.
  }
}

export function readLastUser(): string | null {
  try {
    return storage()?.getItem(LAST_USER_KEY) ?? null;
  } catch {
    return null;
  }
}

// Deletion contract for personal data (a person removed, Start over): besides the state
// itself, every local copy under this account goes: dated backups (corrupt-cache and "theirs" copies) and the cache,
// which is rewritten from the current state right after. Returns how many backup keys were removed.
// Sign out on this device: this account's cached state and backups leave localStorage (a shared phone or laptop keeps
// nothing readable in DevTools). The server copy is untouched; the next sign-in pulls it again.
// At the door (waitlist, not invited) no account is loaded: it is the last one this device remembers.
export function forgetLocalCache(): void {
  const s = storage();
  const id = userId ?? readLastUser();
  if (!s || !id) return;
  forgotten = true;
  if (pushTimer) timers.clearTimeout(pushTimer);
  pushTimer = null;
  try {
    s.removeItem(cacheKey(id));
    s.removeItem(LAST_USER_KEY);
    for (const key of keysWithPrefix(s, BACKUP_PREFIX + id + ":")) s.removeItem(key);
  } catch {
    // Storage can be blocked; nothing to forget then.
  }
  if (typeof caches !== "undefined") void caches.delete(MEDIA_CACHE).catch(() => {});
}

export function purgeLocalCopies(): number {
  const s = storage();
  if (!s || !userId) return 0;
  let n = 0;
  try {
    for (const key of keysWithPrefix(s, BACKUP_PREFIX + userId + ":")) {
      s.removeItem(key);
      n++;
    }
  } catch {
    // Storage can be blocked; the server copy is what the save rewrites.
  }
  recoveredFrom = null;
  // A pending conflict holds the other device's copy in memory; "theirs" could bring the deleted data back. The
  // cleaned state wins: take the server's revision, mark dirty and push right away.
  if (conflict) {
    revision = conflict.local ? Math.max(revision, conflict.revision) : conflict.revision;
    conflict = null;
    dirty = true;
    status = "synced";
  }
  writeCache();
  publish();
  void flush();
  return n;
}

// Raw string of the backup found while loading the cache, for the settings download. No parsing.
export function readRecoveryBackup(): string | null {
  const s = storage();
  if (!s || !recoveredFrom || !userId) return null;
  return s.getItem(BACKUP_PREFIX + userId + ":" + recoveredFrom);
}

// Pre-accounts data on this device, if it looks like someone used the app here.
function readLegacy(): AppState | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(LEGACY_KEY);
  if (raw === null) return null;
  const state = parseState(parseJson(raw));
  return state && state.profile.onboarded ? state : null;
}

// Copies the legacy cache to a dated key and removes the original, so no other account gets offered it.
function retireLegacy() {
  const s = storage();
  if (!s) return;
  try {
    const raw = s.getItem(LEGACY_KEY);
    if (raw !== null) {
      s.setItem(LEGACY_BACKUP_PREFIX + new Date().toISOString(), raw);
      s.removeItem(LEGACY_KEY);
    }
  } catch {
    // Nothing to do: the worst case is being offered the same migration again.
  }
}

// ---- server ----------------------------------------------------------------

type GetResult =
  | { ok: true; revision: number; state: AppState | null }
  | { ok: false; kind: "outdated" }
  | { ok: false; kind: "offline" | "denied" | "error"; message: string };

type PutResult =
  | { ok: true; revision: number }
  | { ok: false; kind: "conflict"; revision: number; state: AppState | null }
  | { ok: false; kind: "outdated" }
  | { ok: false; kind: "offline" | "denied" | "error"; message: string };

function doFetch(input: string, init?: RequestInit): Promise<Response> {
  const f = fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!f) return Promise.reject(new Error("fetch unavailable"));
  return f(input, init);
}

// Whose data this tab believes it holds. The server refuses when the cookie is another account's (signed in from
// another tab), so nothing of one account is ever read into or written over the other.
function accountHeader(): Record<string, string> {
  return userId ? { "x-cwym-user": userId } : {};
}

// The cookie is another account's: this tab lets go of what it shows. Unsent edits stay in this account's cache.
async function denied(res: Response, who: string | null, gen: number): Promise<{ ok: false; kind: "denied"; message: string }> {
  const body = res.status === 403 ? ((await res.json().catch(() => null)) as { error?: unknown } | null) : null;
  if (body?.error === "other_account" && who !== null && gen === generation) resetIdentity(null);
  return { ok: false, kind: "denied", message: `HTTP ${res.status}` };
}

async function serverGet(): Promise<GetResult> {
  const who = userId;
  const gen = generation;
  let res: Response;
  try {
    res = await doFetch(STATE_URL, { method: "GET", headers: { accept: "application/json", ...accountHeader() }, cache: "no-store" });
  } catch (err) {
    return { ok: false, kind: "offline", message: err instanceof Error ? err.message : "offline" };
  }
  if (res.status === 401 || res.status === 403) return denied(res, who, gen);
  if (!res.ok) return { ok: false, kind: "error", message: `HTTP ${res.status}` };
  const body = (await res.json().catch(() => null)) as { revision?: unknown; state?: unknown } | null;
  if (!body || typeof body.revision !== "number") return { ok: false, kind: "error", message: "bad response" };
  if (body.state === null || body.state === undefined) return { ok: true, revision: body.revision, state: null };
  const state = parseState(body.state);
  if (!state) {
    // A newer bundle wrote a state this one cannot read (schema ahead of us): reload once, like an outdated PUT.
    const schema = (body.state as { schema?: unknown }).schema;
    if (typeof schema === "number" && schema > 11) return { ok: false, kind: "outdated" };
    return { ok: false, kind: "error", message: "server state does not parse" };
  }
  return { ok: true, revision: body.revision, state };
}

async function serverPut(baseRevision: number, state: AppState): Promise<PutResult> {
  const who = userId;
  const gen = generation;
  let res: Response;
  try {
    res = await doFetch(STATE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json", ...accountHeader() },
      body: JSON.stringify({ baseRevision, state }),
    });
  } catch (err) {
    return { ok: false, kind: "offline", message: err instanceof Error ? err.message : "offline" };
  }
  if (res.status === 401 || res.status === 403) return denied(res, who, gen);
  const body = (await res.json().catch(() => null)) as { revision?: unknown; state?: unknown } | null;
  if (res.status === 400 && body && (body as { error?: unknown }).error === "outdated_client") {
    return { ok: false, kind: "outdated" };
  }
  if (res.status === 409) {
    const rev = body && typeof body.revision === "number" ? body.revision : 0;
    const st = body && body.state ? parseState(body.state) : null;
    return { ok: false, kind: "conflict", revision: rev, state: st };
  }
  if (!res.ok || !body || typeof body.revision !== "number") {
    return { ok: false, kind: "error", message: `HTTP ${res.status}` };
  }
  return { ok: true, revision: body.revision };
}

// ---- sync machine ----------------------------------------------------------

// A legacy row (before places) has `location` but no saved places: move it into places once. That change is
// new, so it is dirty and goes out on the next push.
function applyServer(rev: number, state: AppState) {
  const migrated = migrateLegacyLocation(state);
  current = migrated;
  revision = rev;
  dirty = migrated !== state;
  conflict = null;
  clearLegacy();
  status = "synced";
  lastError = null;
  writeCache();
}

// The server refused this client as too old (no `pets`). A fresh bundle fixes it: reload once per tab.
// If the flag cannot be read or written, do not reload (that could loop); report the error instead.
// Scoped to the schema tag so a reload for one schema does not block a reload for the next.
const RELOAD_FLAG = `cwym:reloaded:${STATE_SCHEMA_TAG}`;

function reloadOnce() {
  let alreadyReloaded = true;
  if (typeof window !== "undefined") {
    try {
      const s = window.sessionStorage;
      if (s.getItem(RELOAD_FLAG) !== "1") {
        s.setItem(RELOAD_FLAG, "1");
        alreadyReloaded = false;
      }
    } catch {
      alreadyReloaded = true;
    }
  }
  if (!alreadyReloaded) {
    window.location.reload();
    return;
  }
  status = "error";
  lastError = "outdated_client";
  publish();
}

// A successful PUT from this bundle means the client is current: the next outdated answer may reload again.
function clearReloadFlag() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Best effort: a flag that stays set only suppresses one future reload.
  }
}

// Same content regardless of key order (jsonb reorders object keys on the way back from Postgres).
// Mirrors JSON.stringify: keys holding undefined are dropped (they never reach the wire), array holes become null.
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stable(x))).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
// Both sides pass through the legacy-location migration first: a row written as `location` only and its migrated
// in-memory twin (`places.saved` with that one place) are the same content.
function fingerprint(state: AppState): string {
  return stable(migrateLegacyLocation(state));
}
export const fingerprintForTests = fingerprint;
export function sameState(a: AppState, b: AppState): boolean {
  return fingerprint(a) === fingerprint(b);
}

function schedulePush() {
  if (!userId || !hydrated || conflict || offlineOnly) return;
  if (pushTimer) timers.clearTimeout(pushTimer);
  pushTimer = timers.setTimeout(() => {
    pushTimer = null;
    void push();
  }, PUSH_DEBOUNCE_MS);
}

// Server pets win; pets added on this device while the cache was still legacy are kept (by id), up to 6.
function mergePets(server: Pet[], local: Pet[]): Pet[] {
  const ids = new Set(server.map((p) => p.id));
  return [...server, ...local.filter((p) => !ids.has(p.id))].slice(0, 6);
}

// Pets that predate `restrictions` keep their local entry (extras included) but take the server's restrictions.
function mergeLegacyPets(server: Pet[], local: Pet[], predated: Set<string>): Pet[] {
  return mergePets(server, local).map((p) => {
    const localPet = local.find((l) => l.id === p.id);
    return localPet && localPet !== p && predated.has(p.id) ? { ...localPet, restrictions: p.restrictions } : p;
  });
}

// Takes the server's copy of what this legacy cache lacked (places, pets, restrictions, drinks budget, kitchen); local edits stay.
// Pets are merged only when the cache lacked pets or restrictions: a current pet list must not bring back pets deleted on this device.
function mergeLegacy(server: AppState) {
  const hasPetsGap = legacy.pets || legacy.petRestrictions.size > 0;
  const merged: AppState = {
    ...current,
    pets: hasPetsGap ? mergeLegacyPets(server.pets, current.pets, legacy.petRestrictions) : current.pets,
    places: legacy.places ? server.places : current.places,
    profile: {
      ...current.profile,
      drinksBudgetUsd: legacy.drinksBudget ? server.profile.drinksBudgetUsd : current.profile.drinksBudgetUsd,
      kitchen: legacy.kitchen ? server.profile.kitchen : current.profile.kitchen,
    },
    schema: 11,
  };
  const migrated = migrateLegacyLocation(merged);
  current = migrated;
  if (migrated !== merged) dirty = true; // the location-to-place move is new and goes out on the next push
  clearLegacy();
  writeCache();
}

// Before the first push of a legacy cache: take the server's fields so the PUT cannot erase them.
// A different server revision is a conflict, the same as at boot.
// One adoption at a time: a push() that arrives meanwhile waits for the same GET and PUT.
let adoption: Promise<void> | null = null;

function adoptServerFields(): Promise<void> {
  if (adoption) return adoption;
  const gen = generation;
  const startRevision = revision;
  const run = (async (): Promise<void> => {
    const result = await serverGet();
    // Identity or revision moved on while this GET was in flight: its answer no longer applies.
    if (gen !== generation || startRevision !== revision) return;
    if (!result.ok && result.kind === "outdated") {
      reloadOnce();
      return;
    }
    if (!result.ok) {
      status = result.kind === "offline" ? "offline" : "error";
      lastError = result.message;
      publish();
      return;
    }
    if (result.state && result.revision !== revision && sameState(result.state, current)) {
      revision = result.revision;
    } else if (result.state && result.revision !== revision) {
      conflict = { revision: result.revision, state: result.state };
      status = "conflict";
      publish();
      return;
    }
    if (result.state) mergeLegacy(result.state);
    clearLegacy();
    return push();
  })();
  adoption = run;
  void run.finally(() => {
    if (adoption === run) adoption = null;
  });
  return run;
}

function randomId(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 36).toString(36);
  return out;
}

// The old single `location` becomes the first saved place, and the active one. Returns `places` itself when nothing applies.
export function placesFromLegacyLocation(state: AppState): Places {
  const { location, places } = state;
  if (places.saved.length > 0 || !location) return places;
  // Deterministic: the same legacy location migrates to the same id on every device and on every parse, so the
  // server copy and the local copy of one write fingerprint the same (a random id made them differ).
  const id = "loc_" + legacyPlaceId(`${location.zip ?? ""}|${location.city ?? ""}|${location.state ?? ""}|${location.label}`);
  const saved: SavedLocation = {
    id,
    label: location.label.slice(0, 40),
    ...(location.zip !== undefined ? { zip: location.zip } : {}),
    ...(location.city !== undefined ? { city: location.city } : {}),
    ...(location.state !== undefined ? { state: location.state } : {}),
  };
  return { ...places, saved: [saved], activeId: id };
}

function legacyPlaceId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return (h.toString(36) + "00000000").slice(0, 8);
}

function migrateLegacyLocation(state: AppState): AppState {
  const places = placesFromLegacyLocation(state);
  return places === state.places ? state : { ...state, places };
}

async function push(): Promise<void> {
  if (!userId || conflict || offlineOnly) return;
  if (inFlight) return inFlight; // edits made meanwhile marked changedDuringFlight and go out after it
  if (hydrated) adoptDisk(); // what another tab left on disk and has not been announced yet
  if (!dirty || conflict) return;
  if (legacyPending) return adoptServerFields();
  const gen = generation;
  const base = revision;
  const body = current;
  status = "saving";
  const sentBefore = lastSent;
  // Remembered before the request leaves: a reload that cuts the request still knows what was sent.
  lastSent = fingerprint(body);
  writeCache();
  publish();
  changedDuringFlight = false;
  const run = (async () => {
    const result = await serverPut(base, body);
    if (gen !== generation) return; // identity changed while saving
    // A 409 whose server copy is exactly what we sent: our earlier PUT landed but its answer was lost (the page
    // unloaded or navigated mid-request). Adopt the revision instead of raising a conflict over identical content.
    const landed = !result.ok && result.kind === "conflict" && result.state != null && sameState(result.state, body);
    if (result.ok || landed) {
      clearReloadFlag();
      // Another tab may have written on top while the PUT was away: its copy must not be overwritten with ours.
      adoptDisk();
      revision = Math.max(revision, result.revision);
      if (conflict) {
        writeCache();
        publish();
        return;
      }
      if (changedDuringFlight) {
        // Newer local edits exist: they go out next, on top of the revision we just got.
        status = "synced";
        writeCache();
        publish();
        schedulePush();
        return;
      }
      dirty = false;
      status = "synced";
      lastError = null;
      writeCache();
      publish();
      return;
    }
    if (result.kind === "conflict") {
      adoptDisk();
      if (conflict) return; // the other tab's version first; the server's answer comes again after the choice
      if (revision >= result.revision && revision > base) {
        // The other tab is already past that answer.
        status = "synced";
        publish();
        if (dirty) schedulePush();
        return;
      }
      if (result.state && sentBefore !== null && fingerprint(result.state) === sentBefore) {
        // What the server holds is this device's own earlier write, whose answer never came (a tab closed mid-request):
        // the newer edits go on top of it.
        revision = result.revision;
        status = "synced";
        writeCache();
        publish();
        schedulePush();
        return;
      }
      if (result.state && sameState(result.state, current)) {
        // Another tab pushed the copy this one took from disk meanwhile: same content, newer number.
        revision = result.revision;
        dirty = false;
        status = "synced";
        lastError = null;
        writeCache();
        publish();
        return;
      }
      if (result.state) {
        conflict = { revision: result.revision, state: result.state };
        status = "conflict";
      } else {
        // Row vanished (or never existed): our copy becomes the first write.
        revision = 0;
        status = "error";
        lastError = "conflict without server state";
      }
      publish();
      return;
    }
    if (result.kind === "outdated") {
      reloadOnce();
      return;
    }
    status = result.kind === "offline" ? "offline" : "error";
    lastError = result.message;
    publish();
  })().finally(() => {
    if (inFlight === run) inFlight = null; // a PUT of an identity that is gone must not clear the new one's
  });
  inFlight = run;
  return run;
}

// `unsaved`: edits that never fit on the disk (storage full) and only live in memory.
async function boot(id: string, unsaved: (Cache & { disk: string | null; saveError: string | null }) | null = null) {
  const gen = generation;
  if (unsaved) {
    lastDisk = unsaved.disk;
    lastSaveError = unsaved.saveError;
  }
  let cached = unsaved ?? readCache(id);
  if (cached && !unsaved && !isLegacy(cached.legacy) && takeTabCopy(id, cached)) return;
  if (cached) {
    loadCache(cached);
    legacy = cached.legacy;
    legacyPending = isLegacy(legacy);
  }
  status = "loading";
  publish();

  let result = await serverGet();
  if (gen !== generation) return;
  if (!result.ok && result.kind !== "offline" && result.kind !== "outdated") {
    // One more try before settling: right after a sign-in in a fresh browser the first read can come back 401
    // while the session cookie lands, and a passing 5xx should not decide the screen. (the owner saw the admin page
    // flash and the app send him to /start, 2026-11-03.)
    await new Promise<void>((resolve) => timers.setTimeout(resolve, RETRY_READ_MS));
    if (gen !== generation) return;
    result = await serverGet();
    if (gen !== generation) return;
  }

  if (!result.ok && result.kind === "outdated") {
    reloadOnce();
    return;
  }
  if (!result.ok) {
    status = result.kind === "offline" ? "offline" : "error";
    lastError = result.message;
    hydrated = true; // work from the cache; the next focus/online retries
    publish();
    return;
  }

  // Another tab wrote while this GET was on its way: decide on its copy, not on the one read before.
  const before = revision;
  if (adoptDisk()) cached = { ...(cached ?? { legacy: NO_LEGACY }), revision, state: current, dirty, sent: lastSent, edits };
  if (conflict) {
    hydrated = true;
    publish();
    return;
  }
  if (revision > before && result.revision < revision) {
    hydrated = true;
    status = "synced";
    publish();
    if (dirty) void push();
    return;
  }

  if (result.revision === 0 || result.state === null) {
    // Empty account on the server.
    if (cached) {
      dirty = true;
      revision = 0;
      hydrated = true;
      status = "synced";
      publish();
      void push();
      return;
    }
    const legacy = readLegacy();
    if (legacy) {
      migration = { legacy };
      status = "synced";
      publish(); // hydrated stays false: the app waits behind the migration screen
      return;
    }
    current = DEFAULT_STATE;
    revision = 0;
    dirty = false;
    hydrated = true;
    status = "synced";
    writeCache();
    publish();
    return;
  }

  // Server has data. `dirty` is read live: an edit made while this GET was in flight must not be overwritten.
  if (!dirty) {
    applyServer(result.revision, result.state);
    hydrated = true;
    publish();
    if (dirty) schedulePush();
    return;
  }
  if (cached && cached.revision === result.revision) {
    if (legacyPending) mergeLegacy(result.state);
    hydrated = true;
    status = "synced";
    publish();
    void push();
    return;
  }
  if (sameState(result.state, current)) {
    // Our last write landed but this device never got the answer: same content, newer number. Adopt it.
    revision = result.revision;
    dirty = false;
    hydrated = true;
    status = "synced";
    writeCache();
    publish();
    return;
  }
  if (lastSent !== null && fingerprint(result.state) === lastSent) {
    // The server holds exactly what this device last sent; the local copy has newer edits on top (for example
    // dish photos added right after the plan landed). Adopt the revision and push the newer copy over it.
    revision = result.revision;
    hydrated = true;
    status = "synced";
    writeCache();
    publish();
    void push();
    return;
  }
  if (process.env.NODE_ENV !== "production" || typeof window !== "undefined") {
    // Diagnostic for QA: which top-level keys differ between the server copy and what this device last sent / holds.
    const srv = migrateLegacyLocation(result.state) as unknown as Record<string, unknown>;
    const loc = migrateLegacyLocation(current) as unknown as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(srv), ...Object.keys(loc)])].filter((k) => stable(srv[k]) !== stable(loc[k]));
    console.warn(`[sync] conflict on load: server rev ${result.revision} vs cached ${revision}; differing keys: ${keys.join(",") || "(none)"}; lastSent ${lastSent ? (fingerprint(result.state) === lastSent ? "matches" : "differs") : "unknown"}`);
  }
  conflict = { revision: result.revision, state: result.state };
  status = "conflict";
  hydrated = true;
  publish();
}

async function refresh(): Promise<void> {
  if (!userId || !hydrated || conflict || migration || offlineOnly) return;
  adoptDisk();
  if (dirty) return push();
  const gen = generation;
  const result = await serverGet();
  if (gen !== generation) return;
  adoptDisk();
  if (dirty || conflict) return;
  if (!result.ok && result.kind === "outdated") {
    reloadOnce();
    return;
  }
  if (!result.ok) {
    if (status === "synced") return; // keep quiet about a transient failure when nothing is pending
    status = result.kind === "offline" ? "offline" : "error";
    lastError = result.message;
    publish();
    return;
  }
  if (result.state && result.revision > revision) {
    applyServer(result.revision, result.state);
    publish();
    if (dirty) schedulePush();
  } else if (result.state && legacyPending && result.revision === revision) {
    // A clean legacy cache loaded offline: take the server's places and pets now that it is reachable.
    mergeLegacy(result.state);
    status = "synced";
    lastError = null;
    publish();
    if (dirty) schedulePush();
  } else if (status !== "synced") {
    status = "synced";
    lastError = null;
    publish();
  }
}

function onWake() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  void refresh();
}

// An edit that never fit on the disk (storage full) only lives here: one try to send it before it goes.
function letGo() {
  const gen = generation;
  forgotten = true;
  const unsaved = dirty && lastSaveError !== null && !offlineOnly;
  if (!unsaved) return resetIdentity(null);
  void (async () => {
    await push();
    if (gen === generation && dirty) await push(); // edited again while a PUT was already away
    if (gen === generation) resetIdentity(null);
  })();
}

function bindWindowListeners() {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  // Taken, not pushed: the tab that made the edit pushes it, or this one when it wakes (refresh).
  window.addEventListener("storage", (e) => {
    if (!userId) return;
    const s = storage();
    if (e.key === cacheKey(userId) || e.key === null) {
      // Gone: signed out from another tab. Nothing of this account stays in memory or is written back.
      if (s && s.getItem(cacheKey(userId)) === null) letGo();
      else if (hydrated) adoptDisk();
    } else if (e.key === LAST_USER_KEY && e.newValue !== null && e.newValue !== userId) {
      // Someone else signed in from another tab.
      if (!notThisDocument(e.newValue)) resetIdentity(null);
    }
  });
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onWake);
}

// ---- public API ------------------------------------------------------------

// Somebody else than the account this document was made for. Their data is never read here: AccountScope hides the
// screens and loads the page again.
let foreign: string | null = null;

export function getForeign(): string | null {
  return foreign;
}

function notThisDocument(id: string | null): boolean {
  const pinned = documentAccount();
  foreign = id !== null && pinned !== null && id !== pinned ? id : null;
  if (foreign === null) return false;
  if (userId !== null) resetIdentity(null);
  else publish();
  return true;
}

// Called by SyncBoot with Clerk's userId (null while signed out). Switching identity drops everything in memory.
export function setIdentity(id: string | null) {
  if (notThisDocument(id)) return;
  if (id === userId && !offlineOnly) return;
  const unsaved = id !== null && id === userId && dirty && lastSaveError !== null ? { revision, state: current, dirty, legacy, sent: lastSent, edits, disk: lastDisk, saveError: lastSaveError } : null;
  resetIdentity(id);
  if (id) void boot(id, unsaved);
}

// The no-signal screens: this device's copy of the account, with no server calls until setIdentity takes over.
// False when there is no readable copy to open.
export function setOfflineIdentity(id: string): boolean {
  if (notThisDocument(id)) return false;
  resetIdentity(id);
  offlineOnly = true;
  const cached = readCache(id);
  if (!cached) {
    resetIdentity(null);
    return false;
  }
  if (!isLegacy(cached.legacy) && takeTabCopy(id, cached)) return true;
  loadCache(cached);
  legacy = cached.legacy;
  legacyPending = isLegacy(legacy);
  hydrated = true;
  status = "offline";
  publish();
  return true;
}

function resetIdentity(id: string | null) {
  generation++;
  offlineOnly = false;
  forgotten = false;
  lastDisk = null;
  lastSent = null;
  edits = {};
  lastWhole = null;
  if (pushTimer) {
    timers.clearTimeout(pushTimer);
    pushTimer = null;
  }
  inFlight = null;
  adoption = null;
  changedDuringFlight = false;
  userId = id;
  current = DEFAULT_STATE;
  revision = 0;
  dirty = false;
  hydrated = false;
  conflict = null;
  migration = null;
  lastError = null;
  lastSaveError = null;
  recoveredFrom = null;
  clearLegacy();
  status = id ? "loading" : "idle";
  publish();
  if (id) bindWindowListeners();
}

export function getIdentity(): string | null {
  return userId;
}

// Whose photos may be kept on this device: nobody's from the moment someone signs out.
export function mediaOwner(): string | null {
  return forgotten ? null : userId;
}

export function getSnapshot(): StoreSnapshot {
  return snapshot;
}

export function getServerSnapshot(): StoreSnapshot {
  return SERVER_SNAPSHOT;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAppState(update: AppState | ((prev: AppState) => AppState)): void {
  const before = current;
  if (typeof update !== "function") lastWhole = update;
  // Another tab's edit that has not been announced yet goes first, so this one lands on top of it.
  const moved = hydrated && adoptDisk();
  const rebased = moved && typeof update !== "function" ? rebase(before, update, current) : null;
  if (moved && typeof update !== "function" && rebased === null) {
    // Both tabs changed the same thing: the person decides.
    conflict = { revision, state: current, local: true };
    status = "conflict";
    current = update;
    dirty = true;
    countEdit();
    writeCache();
    publish();
    return;
  }
  const next = typeof update === "function" ? update(current) : (rebased ?? update);
  if (next === current) return;
  // A budget edited here is the person's own: adopting the server's budget later must not replace it.
  if (legacy.drinksBudget && next.profile.drinksBudgetUsd !== current.profile.drinksBudgetUsd) {
    legacy = { ...legacy, drinksBudget: false };
  }
  // Same for kitchen: a tool toggled here is the person's own choice.
  if (legacy.kitchen && next.profile.kitchen !== current.profile.kitchen) {
    legacy = { ...legacy, kitchen: false };
  }
  current = next;
  dirty = true;
  countEdit();
  if (inFlight) changedDuringFlight = true; // the PUT in flight carries an older copy
  writeCache();
  publish();
  schedulePush();
}

// A whole state built on an older copy: only the fields it changed are applied. Null when both changed the same field.
function rebase(from: AppState, to: AppState, onto: AppState): AppState | null {
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>, c: Record<string, unknown>, deep: boolean): Record<string, unknown> | null => {
    const out = { ...c };
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const [was, mine, theirs] = [stable(a[key]), stable(b[key]), stable(c[key])];
      if (mine === was || mine === theirs) continue;
      if (theirs === was) out[key] = b[key];
      else if (deep && key === "profile") {
        const profile = merge(a[key] as Record<string, unknown>, b[key] as Record<string, unknown>, c[key] as Record<string, unknown>, false);
        if (!profile) return null;
        out[key] = profile;
      } else return null;
    }
    return out;
  };
  return merge(from, to, onto, true) as AppState | null;
}

// What every screen writes through: bound to the account it was showing. A plan, a photo or an import that arrives after
// someone else signed in belongs to the first account, so it is dropped, never written into the second one.
const refused = new WeakSet<AppState>();
export function setAppStateAs(owner: string | null, update: AppState | ((prev: AppState) => AppState)): void {
  if (owner !== null && owner === userId) return setAppState(update);
  if (typeof update !== "function") refused.add(update);
}

// Kept for callers that persisted explicitly before navigating. setAppState already persists.
export function saveState(state: AppState): boolean {
  if (refused.has(state)) return false;
  // Already applied, maybe on top of another tab's edit: a second time would undo that edit.
  if (state !== current && state !== lastWhole) setAppState(state);
  return lastSaveError === null;
}

// Pushes pending edits now (used before sign-out and on pagehide).
export function flush(): Promise<void> {
  if (pushTimer) {
    timers.clearTimeout(pushTimer);
    pushTimer = null;
  }
  return push();
}

export function retrySync(): Promise<void> {
  return dirty ? push() : refresh();
}

// "theirs": take the other device's version; the unsent local copy is kept under a dated backup key.
// "mine": write this device's version on top of theirs.
export function resolveConflict(choice: "theirs" | "mine") {
  if (!conflict || !userId) return;
  if (conflict.local) return resolveLocalConflict(choice);
  const other = conflict;
  if (choice === "theirs") {
    const s = storage();
    try {
      s?.setItem(BACKUP_PREFIX + userId + ":" + new Date().toISOString(), JSON.stringify({ revision, state: current, dirty: true }));
    } catch {
      // The backup is best effort.
    }
    applyServer(other.revision, other.state);
    publish();
    if (dirty) schedulePush();
    return;
  }
  revision = other.revision;
  conflict = null;
  dirty = true;
  if (legacyPending) mergeLegacy(other.state);
  status = "synced";
  writeCache();
  publish();
  void push();
}

// Two tabs of this device: "theirs" is whatever the other tab has on disk by now, sent or not.
function resolveLocalConflict(choice: "theirs" | "mine") {
  const s = storage();
  const raw = s && userId ? s.getItem(cacheKey(userId)) : null;
  const disk = raw !== null ? parseCache(raw) : null;
  const other = disk ?? { revision: conflict!.revision, state: conflict!.state, dirty: true, sent: null, legacy: NO_LEGACY, edits };
  const mine = { revision, state: current, dirty: true };
  if (raw !== null) lastDisk = raw;
  conflict = null;
  status = offlineOnly ? "offline" : "synced";
  try {
    s?.removeItem(tabCopyKey(userId!));
  } catch {
    // Only a leftover copy.
  }
  if (choice === "theirs") {
    try {
      s?.setItem(BACKUP_PREFIX + userId + ":" + new Date().toISOString(), JSON.stringify(mine));
    } catch {
      // The backup is best effort.
    }
    const own = edits[tabId()] ?? 0;
    loadCache(other);
    edits = { ...edits, [tabId()]: own };
    revision = Math.max(mine.revision, other.revision); // chosen over what this tab already sent
    if (mine.revision > other.revision) dirty = true;
  } else {
    // Its edits were seen and set aside on purpose: the other tab takes this version without asking again.
    edits = { ...other.edits, [tabId()]: edits[tabId()] ?? 0 };
    revision = Math.max(revision, other.revision);
    dirty = true;
    lastSent = other.sent;
  }
  writeCache();
  publish();
  if (dirty) schedulePush();
}

// Answer to the migration screen. Either way the legacy key is retired (copied to a dated key, then removed).
export function decideMigration(use: boolean) {
  if (!migration || !userId) return;
  const legacy = migration.legacy;
  migration = null;
  retireLegacy();
  if (use) {
    current = migrateLegacyLocation(legacy);
    revision = 0;
    dirty = true;
    hydrated = true;
    status = "synced";
    writeCache();
    publish();
    void push();
    return;
  }
  current = DEFAULT_STATE;
  revision = 0;
  dirty = false;
  hydrated = true;
  status = "synced";
  writeCache();
  publish();
}

export function exportState(): string {
  return JSON.stringify(current, null, 2);
}

export function importState(json: string): AppState | Error {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return new Error("That file is not valid JSON.");
  }
  const parsed = AppState.safeParse(migrate(data));
  if (!parsed.success) {
    return new Error(`That file does not match the expected format: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Test-only: a clean module without re-importing.
export function _resetStoreForTests() {
  foreign = null;
  generation++;
  if (pushTimer) timers.clearTimeout(pushTimer);
  pushTimer = null;
  inFlight = null;
  adoption = null;
  changedDuringFlight = false;
  userId = null;
  current = DEFAULT_STATE;
  revision = 0;
  dirty = false;
  hydrated = false;
  status = "idle";
  conflict = null;
  migration = null;
  lastError = null;
  lastSaveError = null;
  recoveredFrom = null;
  listenersBound = false;
  offlineOnly = false;
  forgotten = false;
  lastDisk = null;
  edits = {};
  clearLegacy();
  listeners.clear();
  snapshot = SERVER_SNAPSHOT;
  fetchImpl = null;
  timers = { setTimeout, clearTimeout };
}
