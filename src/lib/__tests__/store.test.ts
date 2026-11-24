import { documentAccount } from "../auth/account";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppState as AppStateSchema, DEFAULT_STATE, Profile, STATE_SCHEMA_TAG, type AppState, type Pet } from "../schemas";
import * as store from "../store";

vi.mock("../auth/account", async (orig) => ({ ...(await orig<typeof import("../auth/account")>()), documentAccount: vi.fn(() => null) }));

class MemoryStorage {
  private data = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  keys() {
    return [...this.data.keys()];
  }
}

type Call = { method: string; body?: { baseRevision: number; state: AppState } };

// Scripted server: each PUT/GET answer is taken from the queue in order.
function fakeServer(answers: Array<{ status: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Call["body"]) : undefined;
    calls.push({ method, body });
    const next = answers.shift();
    if (!next) throw new TypeError("Failed to fetch"); // offline when the script runs out
    return new Response(JSON.stringify(next.json), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, calls };
}

const onboarded: AppState = { ...DEFAULT_STATE, profile: Profile.parse({ version: 1, onboarded: true, proteinTargetG: 150 }) };
const serverState: AppState = { ...onboarded, favorites: ["from-server"] };

let storage: MemoryStorage;
const pending: Array<() => void> = [];
const timers = {
  setTimeout: ((fn: () => void) => {
    pending.push(fn);
    return pending.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout,
  clearTimeout: (() => {
    pending.length = 0;
  }) as typeof clearTimeout,
};
const runTimers = () => {
  const fns = pending.splice(0);
  for (const fn of fns) fn();
};
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage, addEventListener() {}, removeEventListener() {} });
  store._resetStoreForTests();
});

afterEach(() => {
  store._resetStoreForTests();
  vi.unstubAllGlobals();
});

async function signIn(id: string, answers: Array<{ status: number; json: unknown }>) {
  const server = fakeServer(answers);
  store.configureStore({ fetch: server.fetch, timers });
  store.setIdentity(id);
  await settle();
  await settle();
  return server;
}

describe("store: identity and boot", () => {
  it("is idle and not hydrated before an identity arrives", () => {
    const snap = store.getSnapshot();
    expect(snap.hydrated).toBe(false);
    expect(snap.sync.status).toBe("idle");
  });

  it("empty server, nothing local: hydrates with defaults and writes the per-account cache", async () => {
    await signIn("user_a", [{ status: 200, json: { revision: 0, state: null } }]);
    const snap = store.getSnapshot();
    expect(snap.hydrated).toBe(true);
    expect(snap.sync.status).toBe("synced");
    expect(snap.state).toEqual(DEFAULT_STATE);
    expect(storage.keys()).toContain(store.CACHE_PREFIX + "user_a");
  });

  it("server has data and local is clean: takes the server copy", async () => {
    await signIn("user_a", [{ status: 200, json: { revision: 3, state: serverState } }]);
    const snap = store.getSnapshot();
    expect(snap.state.favorites).toEqual(["from-server"]);
    expect(snap.sync.revision).toBe(3);
    expect(snap.sync.dirty).toBe(false);
  });

  it("a failed first read is retried once: 401 then 200 hydrates synced with the server copy", async () => {
    const server = await signIn("user_a", [
      { status: 401, json: { error: "unauthorized" } },
      { status: 200, json: { revision: 3, state: serverState } },
    ]);
    // Still loading while the retry timer waits: nothing decided yet, so no redirect to /start.
    expect(store.getSnapshot().hydrated).toBe(false);
    expect(store.getSnapshot().sync.status).toBe("loading");
    runTimers();
    await settle();
    await settle();
    const snap = store.getSnapshot();
    expect(server.calls.filter((c) => c.method === "GET").length).toBe(2);
    expect(snap.hydrated).toBe(true);
    expect(snap.sync.status).toBe("synced");
    expect(snap.state.favorites).toEqual(["from-server"]);
  });

  it("two failed reads: hydrates from the cache (or defaults) and reports error, not synced", async () => {
    await signIn("user_a", [
      { status: 500, json: { error: "boom" } },
      { status: 500, json: { error: "boom" } },
    ]);
    runTimers();
    await settle();
    await settle();
    const snap = store.getSnapshot();
    expect(snap.hydrated).toBe(true);
    expect(snap.sync.status).toBe("error");
    expect(snap.state.profile.onboarded).toBe(false);
  });

  it("offline at boot: works from the cache and reports offline", async () => {
    storage.setItem(store.CACHE_PREFIX + "user_a", JSON.stringify({ revision: 2, state: onboarded, dirty: false }));
    await signIn("user_a", []);
    const snap = store.getSnapshot();
    expect(snap.hydrated).toBe(true);
    expect(snap.sync.status).toBe("offline");
    expect(snap.state.profile.onboarded).toBe(true);
  });

  it("switching accounts clears memory and never shows the other account's state", async () => {
    await signIn("user_a", [{ status: 200, json: { revision: 3, state: serverState } }]);
    expect(store.getSnapshot().state.favorites).toEqual(["from-server"]);
    const b = fakeServer([{ status: 200, json: { revision: 0, state: null } }]);
    store.configureStore({ fetch: b.fetch, timers });
    store.setIdentity("user_b");
    // Synchronously after the switch: defaults, not hydrated, nothing of A left.
    expect(store.getSnapshot().state).toEqual(DEFAULT_STATE);
    expect(store.getSnapshot().hydrated).toBe(false);
    await settle();
    await settle();
    expect(store.getSnapshot().state.favorites).toEqual([]);
    expect(storage.getItem(store.CACHE_PREFIX + "user_b")).not.toBeNull();
    const cachedA = JSON.parse(storage.getItem(store.CACHE_PREFIX + "user_a")!);
    expect(cachedA.state.favorites).toEqual(["from-server"]); // A's cache stays A's
  });

  it("signing out drops state and stops syncing", async () => {
    await signIn("user_a", [{ status: 200, json: { revision: 3, state: serverState } }]);
    store.setIdentity(null);
    expect(store.getSnapshot().state).toEqual(DEFAULT_STATE);
    expect(store.getSnapshot().sync.status).toBe("idle");
  });
});

describe("store: edits and push", () => {
  it("an edit marks dirty, saves locally, and pushes once after the debounce", async () => {
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 0, state: null } },
      { status: 200, json: { revision: 1 } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["x"] }));
    expect(store.getSnapshot().sync.dirty).toBe(true);
    expect(JSON.parse(storage.getItem(store.CACHE_PREFIX + "user_a")!).state.favorites).toEqual(["x"]);
    expect(server.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    runTimers();
    await settle();
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.baseRevision).toBe(0);
    expect(store.getSnapshot().sync).toMatchObject({ status: "synced", revision: 1, dirty: false });
  });

  it("edits made while a PUT is in flight go out in a second PUT on top of the new revision", async () => {
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 0, state: null } },
      { status: 200, json: { revision: 1 } },
      { status: 200, json: { revision: 2 } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["a"] }));
    runTimers();
    store.setAppState((s) => ({ ...s, favorites: ["a", "b"] })); // during flight
    await settle();
    await settle();
    runTimers();
    await settle();
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts.map((p) => p.body?.baseRevision)).toEqual([0, 1]);
    expect(puts[1].body?.state.favorites).toEqual(["a", "b"]);
    expect(store.getSnapshot().sync).toMatchObject({ revision: 2, dirty: false });
  });

  it("a 409 whose server copy equals what we sent adopts the revision (answer lost mid-PUT)", async () => {
    await signIn("user_a", [
      { status: 200, json: { revision: 1, state: serverState } },
      { status: 409, json: { error: "conflict", revision: 2, state: { ...serverState, favorites: ["mine"] } } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["mine"] }));
    runTimers();
    await settle();
    await settle();
    const snap = store.getSnapshot();
    expect(snap.sync.status).toBe("synced");
    expect(snap.sync.conflict).toBeNull();
    expect(snap.sync).toMatchObject({ revision: 2, dirty: false });
    expect(snap.state.favorites).toEqual(["mine"]);
  });

  it("a 409 becomes a conflict and nothing is merged", async () => {
    await signIn("user_a", [
      { status: 200, json: { revision: 1, state: serverState } },
      { status: 409, json: { error: "conflict", revision: 2, state: { ...serverState, favorites: ["other-device"] } } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["mine"] }));
    runTimers();
    await settle();
    await settle();
    const snap = store.getSnapshot();
    expect(snap.sync.status).toBe("conflict");
    expect(snap.state.favorites).toEqual(["mine"]); // local untouched
    expect(snap.sync.conflict?.state.favorites).toEqual(["other-device"]);
  });

  it("conflict → 'theirs' takes the server copy and keeps a backup of the local one", async () => {
    await signIn("user_a", [
      { status: 200, json: { revision: 1, state: serverState } },
      { status: 409, json: { error: "conflict", revision: 2, state: { ...serverState, favorites: ["other-device"] } } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["mine"] }));
    runTimers();
    await settle();
    await settle();
    store.resolveConflict("theirs");
    const snap = store.getSnapshot();
    expect(snap.state.favorites).toEqual(["other-device"]);
    expect(snap.sync).toMatchObject({ status: "synced", revision: 2, dirty: false });
    const backups = storage.keys().filter((k) => k.startsWith(store.BACKUP_PREFIX + "user_a:"));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(storage.getItem(backups[0])!).state.favorites).toEqual(["mine"]);
  });

  it("purgeLocalCopies removes every backup key for the account and keeps the cache", async () => {
    await signIn("user_a", [
      { status: 200, json: { revision: 1, state: serverState } },
      { status: 409, json: { error: "conflict", revision: 2, state: { ...serverState, favorites: ["other-device"] } } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["mine"] }));
    runTimers();
    await settle();
    await settle();
    store.resolveConflict("theirs");
    storage.setItem(store.BACKUP_PREFIX + "user_a:2026-01-01T00:00:00.000Z", "{}");
    storage.setItem(store.BACKUP_PREFIX + "user_b:2026-01-01T00:00:00.000Z", "{}");
    expect(storage.keys().filter((k) => k.startsWith(store.BACKUP_PREFIX + "user_a:"))).toHaveLength(2);
    expect(store.purgeLocalCopies()).toBe(2);
    expect(storage.keys().filter((k) => k.startsWith(store.BACKUP_PREFIX + "user_a:"))).toHaveLength(0);
    // Another account's backup and this account's cache are untouched.
    expect(storage.keys().filter((k) => k.startsWith(store.BACKUP_PREFIX + "user_b:"))).toHaveLength(1);
    expect(storage.keys().some((k) => k.startsWith(store.CACHE_PREFIX + "user_a"))).toBe(true);
    expect(store.getSnapshot().recoveredFrom).toBeNull();
  });

  it("forgetLocalCache drops this account's cache and backups, nobody else's", async () => {
    await signIn("user_a", [{ status: 200, json: { revision: 1, state: serverState } }]);
    store.setAppState((s) => ({ ...s, favorites: ["mine"] }));
    runTimers();
    await settle();
    storage.setItem(store.BACKUP_PREFIX + "user_a:2026-01-01T00:00:00.000Z", "{}");
    storage.setItem(store.CACHE_PREFIX + "user_b", "{}");
    expect(storage.keys().some((k) => k === store.CACHE_PREFIX + "user_a")).toBe(true);
    store.forgetLocalCache();
    expect(storage.keys().some((k) => k.startsWith(store.CACHE_PREFIX + "user_a"))).toBe(false);
    expect(storage.keys().filter((k) => k.startsWith(store.BACKUP_PREFIX + "user_a:"))).toHaveLength(0);
    expect(storage.keys().some((k) => k === store.CACHE_PREFIX + "user_b")).toBe(true);
  });
  it("purgeLocalCopies during a conflict drops the other device's snapshot and pushes the cleaned state", async () => {
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 1, state: serverState } },
      { status: 409, json: { error: "conflict", revision: 2, state: { ...serverState, favorites: ["other-device"] } } },
      { status: 200, json: { revision: 3 } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["mine"] }));
    runTimers();
    await settle();
    await settle();
    expect(store.getSnapshot().sync.conflict).not.toBeNull();
    store.purgeLocalCopies();
    await settle();
    await settle();
    const snap = store.getSnapshot();
    expect(snap.sync.conflict).toBeNull();
    expect(snap.state.favorites).toEqual(["mine"]);
    // Pushed on top of the server's revision, so the deletion reaches the server instead of waiting on a choice.
    expect(server.calls[server.calls.length - 1].body?.baseRevision).toBe(2);
    expect(snap.sync.revision).toBe(3);
  });

  it("conflict → 'mine' writes the local copy on top of the server revision", async () => {
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 1, state: serverState } },
      { status: 409, json: { error: "conflict", revision: 2, state: { ...serverState, favorites: ["other-device"] } } },
      { status: 200, json: { revision: 3 } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["mine"] }));
    runTimers();
    await settle();
    await settle();
    store.resolveConflict("mine");
    await settle();
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts.map((p) => p.body?.baseRevision)).toEqual([1, 2]);
    expect(store.getSnapshot().sync).toMatchObject({ status: "synced", revision: 3, dirty: false });
    expect(store.getSnapshot().state.favorites).toEqual(["mine"]);
  });

  it("offline PUT keeps the edit dirty in the cache and reports offline", async () => {
    await signIn("user_a", [{ status: 200, json: { revision: 1, state: serverState } }]);
    store.setAppState((s) => ({ ...s, favorites: ["offline-edit"] }));
    runTimers();
    await settle();
    await settle();
    expect(store.getSnapshot().sync.status).toBe("offline");
    const cached = JSON.parse(storage.getItem(store.CACHE_PREFIX + "user_a")!);
    expect(cached.dirty).toBe(true);
    expect(cached.state.favorites).toEqual(["offline-edit"]);
  });

  it("a dirty cache from an earlier session is pushed at boot when revisions match", async () => {
    storage.setItem(store.CACHE_PREFIX + "user_a", JSON.stringify({ revision: 1, state: { ...serverState, favorites: ["pending"] }, dirty: true }));
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 1, state: serverState } },
      { status: 200, json: { revision: 2 } },
    ]);
    await settle();
    expect(server.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(store.getSnapshot().state.favorites).toEqual(["pending"]);
    expect(store.getSnapshot().sync.revision).toBe(2);
  });

  it("a legacy location migrates to the same saved-place id every time", () => {
    const legacy = { ...serverState, location: { label: "Somerville, MA", zip: "02143", city: "Somerville", state: "MA" }, places: { saved: [], activeId: null } } as unknown as AppState;
    const a = store.placesFromLegacyLocation(legacy);
    const b = store.placesFromLegacyLocation(JSON.parse(JSON.stringify(legacy)) as AppState);
    expect(a.saved[0].id).toBe(b.saved[0].id);
    expect(a.saved[0].id).toMatch(/^loc_[0-9a-z]{8}$/);
    expect(store.fingerprintForTests(legacy)).toBe(store.fingerprintForTests(JSON.parse(JSON.stringify(legacy)) as AppState));
  });

  it("fingerprint ignores keys holding undefined and key order, like the JSON that goes over the wire", () => {
    const base = { ...serverState, favorites: ["x"] };
    const withUndefined = { ...base, leftover: undefined } as unknown as AppState;
    const roundTripped = JSON.parse(JSON.stringify(base)) as AppState;
    expect(store.fingerprintForTests(withUndefined)).toBe(store.fingerprintForTests(roundTripped));
  });

  it("same, when the cache and what was sent are schema 10 (before mealDrinks): still no conflict", async () => {
    const { mealDrinks: _new, ...oldProfile } = serverState.profile;
    void _new;
    const v10 = (favorites: string[]) => ({ ...serverState, schema: 10, profile: oldProfile, favorites });
    const sent = store.fingerprintForTests(v10(["sent"]) as unknown as AppState);
    storage.setItem(store.CACHE_PREFIX + "user_a", JSON.stringify({ revision: 3, state: v10(["sent", "newer"]), dirty: true, sent }));
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 4, state: v10(["sent"]) } },
      { status: 200, json: { revision: 5 } },
    ]);
    expect(store.getSnapshot().sync.conflict).toBeNull();
    expect(server.calls[1]?.body?.baseRevision).toBe(4);
    expect(server.calls[1]?.body?.state.favorites).toEqual(["sent", "newer"]);
    expect(server.calls[1]?.body?.state.schema).toBe(11);
  });

  it("a dirty cache whose last PUT landed (server holds exactly what was sent) adopts the revision and pushes the newer copy", async () => {
    // The PUT of ["sent"] was cut mid-request; the server committed it as revision 4. Local edits continued (["sent", "newer"]).
    const sentBody = { ...serverState, favorites: ["sent"] };
    const fingerprint = store.fingerprintForTests(sentBody);
    storage.setItem(store.CACHE_PREFIX + "user_a", JSON.stringify({ revision: 3, state: { ...serverState, favorites: ["sent", "newer"] }, dirty: true, sent: fingerprint }));
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 4, state: sentBody } },
      { status: 200, json: { revision: 5 } },
    ]);
    await settle();
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(store.getSnapshot().sync.conflict).toBeNull();
    expect(puts.map((p) => p.body?.baseRevision)).toEqual([4]);
    expect(puts[0].body?.state.favorites).toEqual(["sent", "newer"]);
    expect(store.getSnapshot().sync).toMatchObject({ revision: 5, dirty: false, status: "synced" });
  });

  it("a dirty cache behind the server revision becomes a conflict, not a silent overwrite", async () => {
    storage.setItem(store.CACHE_PREFIX + "user_a", JSON.stringify({ revision: 1, state: { ...serverState, favorites: ["pending"] }, dirty: true }));
    const server = await signIn("user_a", [{ status: 200, json: { revision: 4, state: serverState } }]);
    expect(server.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(store.getSnapshot().sync.status).toBe("conflict");
    expect(store.getSnapshot().state.favorites).toEqual(["pending"]);
  });
});

describe("store: legacy migration", () => {
  it("offers pre-accounts data only when the server is empty, and waits for the answer", async () => {
    storage.setItem(store.LEGACY_KEY, JSON.stringify(onboarded));
    await signIn("user_a", [{ status: 200, json: { revision: 0, state: null } }]);
    const snap = store.getSnapshot();
    expect(snap.hydrated).toBe(false);
    expect(snap.sync.migration?.legacy.profile.proteinTargetG).toBe(150);
  });

  it("'use it' uploads the legacy copy and retires the legacy key", async () => {
    storage.setItem(store.LEGACY_KEY, JSON.stringify(onboarded));
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 0, state: null } },
      { status: 200, json: { revision: 1 } },
    ]);
    store.decideMigration(true);
    await settle();
    await settle();
    expect(store.getSnapshot().hydrated).toBe(true);
    expect(store.getSnapshot().state.profile.proteinTargetG).toBe(150);
    expect(server.calls.filter((c) => c.method === "PUT")[0].body?.baseRevision).toBe(0);
    expect(storage.getItem(store.LEGACY_KEY)).toBeNull();
    expect(storage.keys().some((k) => k.startsWith(store.LEGACY_BACKUP_PREFIX))).toBe(true);
  });

  it("'start fresh' keeps a copy but does not upload it, and a second account is never offered it", async () => {
    storage.setItem(store.LEGACY_KEY, JSON.stringify(onboarded));
    const server = await signIn("user_a", [{ status: 200, json: { revision: 0, state: null } }]);
    store.decideMigration(false);
    await settle();
    expect(store.getSnapshot().state).toEqual(DEFAULT_STATE);
    expect(server.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(storage.getItem(store.LEGACY_KEY)).toBeNull();
    await signIn("user_b", [{ status: 200, json: { revision: 0, state: null } }]);
    expect(store.getSnapshot().sync.migration).toBeNull();
    expect(store.getSnapshot().hydrated).toBe(true);
  });

  it("legacy data that never finished onboarding is not offered", async () => {
    storage.setItem(store.LEGACY_KEY, JSON.stringify(DEFAULT_STATE));
    await signIn("user_a", [{ status: 200, json: { revision: 0, state: null } }]);
    expect(store.getSnapshot().sync.migration).toBeNull();
    expect(store.getSnapshot().hydrated).toBe(true);
  });

  it("legacy data is ignored when the account already has server data", async () => {
    storage.setItem(store.LEGACY_KEY, JSON.stringify(onboarded));
    await signIn("user_a", [{ status: 200, json: { revision: 2, state: serverState } }]);
    expect(store.getSnapshot().sync.migration).toBeNull();
    expect(store.getSnapshot().state.favorites).toEqual(["from-server"]);
  });
});

describe("store: cache safety", () => {
  it("an unreadable per-account cache is backed up and replaced by the server copy", async () => {
    storage.setItem(store.CACHE_PREFIX + "user_a", "{not json");
    await signIn("user_a", [{ status: 200, json: { revision: 1, state: serverState } }]);
    expect(store.getSnapshot().recoveredFrom).not.toBeNull();
    expect(store.readRecoveryBackup()).toBe("{not json");
    expect(store.getSnapshot().state.favorites).toEqual(["from-server"]);
  });

  it("reports saveError when localStorage writes fail but keeps the in-memory value", async () => {
    await signIn("user_a", [{ status: 200, json: { revision: 0, state: null } }]);
    storage.failWrites = true;
    store.setAppState((s) => ({ ...s, favorites: ["x"] }));
    expect(store.getSnapshot().saveError).toMatch(/Quota/);
    expect(store.getSnapshot().state.favorites).toEqual(["x"]);
  });

  it("importState rejects invalid JSON and the wrong shape, and round-trips DEFAULT_STATE", () => {
    expect(store.importState("{not json")).toBeInstanceOf(Error);
    expect(store.importState(JSON.stringify({ hello: "world" }))).toBeInstanceOf(Error);
    expect(store.importState(JSON.stringify(DEFAULT_STATE))).toEqual(DEFAULT_STATE);
  });

  it("migrate is the identity for v1 and for unknown shapes", () => {
    expect(store.migrate({ version: 1, a: 1 })).toEqual({ version: 1, a: 1 });
    expect(store.migrate({ version: 99 })).toEqual({ version: 99 });
  });
});

describe("store: outdated client", () => {
  it("PUT 400 outdated_client reloads once per tab, then reports error without looping", async () => {
    const session = new MemoryStorage();
    const reload = vi.fn();
    vi.stubGlobal("window", {
      localStorage: storage,
      sessionStorage: session,
      location: { reload },
      addEventListener() {},
      removeEventListener() {},
    });
    const server = fakeServer([
      { status: 200, json: { revision: 0, state: null } },
      { status: 400, json: { error: "outdated_client", issues: [] } },
      { status: 400, json: { error: "outdated_client", issues: [] } },
    ]);
    store.configureStore({ fetch: server.fetch, timers });
    store.setIdentity("user_a");
    await settle();
    await settle();

    store.setAppState((s) => ({ ...s, favorites: ["x"] }));
    runTimers();
    await settle();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(session.getItem(`cwym:reloaded:${STATE_SCHEMA_TAG}`)).toBe("1");

    store.setAppState((s) => ({ ...s, favorites: ["y"] }));
    runTimers();
    await settle();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sync.status).toBe("error");
    expect(store.getSnapshot().sync.lastError).toBe("outdated_client");
  });
});

describe("store: legacy cache without pets", () => {
  const pet: Pet = {
    id: "pet_server01",
    name: "Rex",
    species: "dog",
    weightKg: 10,
    bornYearMonth: "2020-01",
    neutered: true,
    restrictions: [],
    extrasLog: [],
  };
  // A cache written before pets existed: same fields, no `pets` key.
  function legacyCache(revision: number, favorites: string[]) {
    const state: Record<string, unknown> = { ...serverState, favorites, pets: undefined };
    delete state.pets;
    return JSON.stringify({ revision, state, dirty: true });
  }

  it("boot pushes a dirty legacy cache with the server's pets and keeps the local edit", async () => {
    storage.setItem(store.CACHE_PREFIX + "user_a", legacyCache(3, ["local-edit"]));
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 3, state: { ...serverState, pets: [pet] } } },
      { status: 200, json: { revision: 4 } },
    ]);
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.baseRevision).toBe(3);
    expect(puts[0].body?.state.pets).toEqual([pet]);
    expect(puts[0].body?.state.favorites).toEqual(["local-edit"]);
    expect(store.getSnapshot().state.pets).toEqual([pet]);
    expect(store.getSnapshot().sync).toMatchObject({ status: "synced", revision: 4, dirty: false });
  });

  it("conflict 'mine' on a legacy cache writes the server's pets on top of their revision", async () => {
    storage.setItem(store.CACHE_PREFIX + "user_a", legacyCache(1, ["local-edit"]));
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 2, state: { ...serverState, pets: [pet] } } },
      { status: 200, json: { revision: 3 } },
    ]);
    expect(store.getSnapshot().sync.status).toBe("conflict");
    store.resolveConflict("mine");
    await settle();
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.baseRevision).toBe(2);
    expect(puts[0].body?.state.pets).toEqual([pet]);
    expect(puts[0].body?.state.favorites).toEqual(["local-edit"]);
  });

  it("a legacy cache that went out while offline adopts the server's pets before its first push", async () => {
    storage.setItem(store.CACHE_PREFIX + "user_a", legacyCache(3, ["offline-edit"]));
    await signIn("user_a", []); // boot offline: works from the cache
    expect(store.getSnapshot().sync.status).toBe("offline");
    const server = fakeServer([
      { status: 200, json: { revision: 3, state: { ...serverState, pets: [pet] } } },
      { status: 200, json: { revision: 4 } },
    ]);
    store.configureStore({ fetch: server.fetch, timers });
    store.setAppState((s) => ({ ...s, favorites: ["offline-edit", "more"] }));
    runTimers();
    await settle();
    await settle();
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.state.pets).toEqual([pet]);
    expect(puts[0].body?.state.favorites).toEqual(["offline-edit", "more"]);
    expect(store.getSnapshot().sync).toMatchObject({ status: "synced", revision: 4, dirty: false });
  });
});

describe("store: legacy cache before schema 2 (places and restrictions)", () => {
  // Fields that predate schema 2 are missing from the raw cache: no `schema`, no `places`, no `restrictions` on the pet.
  const legacyRaw = {
    version: 1,
    profile: serverState.profile,
    location: null,
    plan: null,
    favoriteRecipes: {},
    haveAtHome: [],
    checked: [],
  };
  const localPetRaw = {
    id: "pet_server01",
    name: "Rex",
    species: "dog",
    weightKg: 10,
    bornYearMonth: "2020-01",
    neutered: true,
    extrasLog: [{ date: "2026-10-30", kcal: 120, label: "Egg" }],
  };
  const place = { id: "loc_server01", label: "02143", zip: "02143", radiusMiles: 3 as const };

  it("a dirty cache without schema keeps the server's places and pet restrictions, and the local edit", async () => {
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 3, state: { ...legacyRaw, favorites: ["local-edit"], pets: [localPetRaw] }, dirty: true }),
    );
    const serverPet = { ...localPetRaw, extrasLog: [], restrictions: [{ kind: "chicken" }] };
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 3, state: { ...serverState, pets: [serverPet], places: { saved: [place], activeId: place.id } } } },
      { status: 200, json: { revision: 4 } },
    ]);
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.baseRevision).toBe(3);
    expect(puts[0].body?.state.schema).toBe(11);
    expect(puts[0].body?.state.favorites).toEqual(["local-edit"]);
    expect(puts[0].body?.state.places).toEqual({ saved: [place], activeId: place.id });
    expect(puts[0].body?.state.pets[0].restrictions).toEqual([{ kind: "chicken" }]);
    expect(puts[0].body?.state.pets[0].extrasLog).toEqual(localPetRaw.extrasLog);
    expect(store.getSnapshot().sync).toMatchObject({ status: "synced", revision: 4, dirty: false });
  });

  it("a cache that already has schema 2 and the drinks budget does not enter legacy: one GET, then the PUT", async () => {
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({
        revision: 1,
        state: { ...legacyRaw, schema: 2, places: { saved: [] }, favorites: ["schema2-edit"], pets: [{ ...localPetRaw, restrictions: [] }] },
        dirty: true,
      }),
    );
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 1, state: serverState } },
      { status: 200, json: { revision: 2 } },
    ]);
    await settle();
    expect(server.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(server.calls[1].body?.state.favorites).toEqual(["schema2-edit"]);
    expect(server.calls[1].body?.state.schema).toBe(11);
  });

  const serverPetWithRestrictions = { ...localPetRaw, extrasLog: [], restrictions: [{ kind: "chicken" }] };
  const serverPlaces = { saved: [place], activeId: place.id };

  it("an offline edit on a legacy cache keeps the legacy flags, so a later boot still adopts the server's places and restrictions", async () => {
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 3, state: { ...legacyRaw, favorites: ["local-edit"], pets: [localPetRaw] }, dirty: false }),
    );
    await signIn("user_a", []); // boot offline: works from the legacy cache
    expect(store.getSnapshot().sync.status).toBe("offline");
    store.setAppState((s) => ({ ...s, favorites: ["offline-edit"] }));
    const cached = JSON.parse(storage.getItem(store.CACHE_PREFIX + "user_a")!);
    expect(cached.legacy).toEqual({ schema: true, pets: false, places: true, petRestrictions: ["pet_server01"], drinksBudget: false, kitchen: false });

    // Reload: a fresh module reads the same storage; the server now has places and restrictions at the same revision.
    store._resetStoreForTests();
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 3, state: { ...serverState, pets: [serverPetWithRestrictions], places: serverPlaces } } },
      { status: 200, json: { revision: 4 } },
    ]);
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.baseRevision).toBe(3);
    expect(puts[0].body?.state.places).toEqual(serverPlaces);
    expect(puts[0].body?.state.pets[0].restrictions).toEqual([{ kind: "chicken" }]);
    expect(puts[0].body?.state.favorites).toEqual(["offline-edit"]);
  });

  it("a schema 3 cache without drinksBudgetUsd adopts the server's budget at the same revision, and the next PUT sends it", async () => {
    // Raw cache from before schema 4: its profile has no drinksBudgetUsd key at all.
    const profileV3: Record<string, unknown> = { ...serverState.profile };
    delete profileV3.drinksBudgetUsd;
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 3, state: { ...legacyRaw, schema: 3, profile: profileV3, favorites: ["local-edit"], pets: [] }, dirty: true }),
    );
    const serverWithBudget = { ...serverState, profile: { ...serverState.profile, drinksBudgetUsd: 25 } };
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 3, state: serverWithBudget } },
      { status: 200, json: { revision: 4 } },
    ]);
    await settle();
    expect(store.getSnapshot().state.profile.drinksBudgetUsd).toBe(25);
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.baseRevision).toBe(3);
    expect(puts[0].body?.state.profile.drinksBudgetUsd).toBe(25);
    expect(puts[0].body?.state.favorites).toEqual(["local-edit"]);
    expect(store.getSnapshot().sync).toMatchObject({ status: "synced", revision: 4, dirty: false });
  });

  it("a schema 4 cache without kitchen adopts the server's kitchen at the same revision, and the next PUT sends it", async () => {
    // Raw cache from before schema 5: its profile has no kitchen key at all.
    const profileV4: Record<string, unknown> = { ...serverState.profile };
    delete profileV4.kitchen;
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 3, state: { ...legacyRaw, schema: 4, profile: profileV4, favorites: ["local-edit"], pets: [] }, dirty: true }),
    );
    const serverKitchen = { stove: true, oven: true, microwave: false, airFryer: false, blender: false, toaster: false, riceCooker: false, multiCooker: false };
    const serverWithKitchen = { ...serverState, profile: { ...serverState.profile, kitchen: serverKitchen } };
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 3, state: serverWithKitchen } },
      { status: 200, json: { revision: 4 } },
    ]);
    await settle();
    expect(store.getSnapshot().state.profile.kitchen).toEqual(serverKitchen);
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.baseRevision).toBe(3);
    expect(puts[0].body?.state.profile.kitchen).toEqual(serverKitchen);
    expect(puts[0].body?.state.favorites).toEqual(["local-edit"]);
    expect(store.getSnapshot().sync).toMatchObject({ status: "synced", revision: 4, dirty: false });
  });

  it("a kitchen edited while the boot GET is pending wins over the server's kitchen, and the edit clears the legacy flag in the cache", async () => {
    const profileV4: Record<string, unknown> = { ...serverState.profile };
    delete profileV4.kitchen;
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 3, state: { ...legacyRaw, schema: 4, profile: profileV4, favorites: [], pets: [] }, dirty: false }),
    );
    let answerGet!: (res: Response) => void;
    const calls: Call[] = [];
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? (JSON.parse(String(init.body)) as Call["body"]) : undefined });
      if (method === "GET") return new Promise<Response>((resolve) => (answerGet = resolve));
      return Promise.resolve(new Response(JSON.stringify({ revision: 4 }), { status: 200, headers: { "content-type": "application/json" } }));
    });
    store.configureStore({ fetch, timers });
    store.setIdentity("user_a");
    await settle();
    const localKitchen = { stove: false, oven: false, microwave: true, airFryer: true, blender: false, toaster: false, riceCooker: false, multiCooker: false };
    store.setAppState((s) => ({ ...s, profile: { ...s.profile, kitchen: localKitchen } }));
    const cached = JSON.parse(storage.getItem(store.CACHE_PREFIX + "user_a")!);
    expect(cached.legacy.kitchen).toBe(false);

    const serverKitchen = { stove: true, oven: true, microwave: false, airFryer: false, blender: false, toaster: false, riceCooker: false, multiCooker: false };
    answerGet(new Response(JSON.stringify({ revision: 3, state: { ...serverState, profile: { ...serverState.profile, kitchen: serverKitchen } } }), { status: 200, headers: { "content-type": "application/json" } }));
    await settle();
    await settle();
    expect(store.getSnapshot().state.profile.kitchen).toEqual(localKitchen);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.state.profile.kitchen).toEqual(localKitchen);
  });

  it("a budget edited while the boot GET is pending wins over the server's budget, and the edit clears the legacy flag in the cache", async () => {
    const profileV3: Record<string, unknown> = { ...serverState.profile };
    delete profileV3.drinksBudgetUsd;
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 3, state: { ...legacyRaw, schema: 3, profile: profileV3, favorites: [], pets: [] }, dirty: false }),
    );
    // The GET stays pending until the test answers it, so the edit lands while the server has not answered.
    let answerGet!: (res: Response) => void;
    const calls: Call[] = [];
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? (JSON.parse(String(init.body)) as Call["body"]) : undefined });
      if (method === "GET") return new Promise<Response>((resolve) => (answerGet = resolve));
      return Promise.resolve(new Response(JSON.stringify({ revision: 4 }), { status: 200, headers: { "content-type": "application/json" } }));
    });
    store.configureStore({ fetch, timers });
    store.setIdentity("user_a");
    await settle();
    store.setAppState((s) => ({ ...s, profile: { ...s.profile, drinksBudgetUsd: 40 } }));
    const cached = JSON.parse(storage.getItem(store.CACHE_PREFIX + "user_a")!);
    expect(cached.legacy.drinksBudget).toBe(false);

    const serverWithBudget = { ...serverState, profile: { ...serverState.profile, drinksBudgetUsd: 25 } };
    answerGet(new Response(JSON.stringify({ revision: 3, state: serverWithBudget }), { status: 200, headers: { "content-type": "application/json" } }));
    await settle();
    await settle();
    expect(store.getSnapshot().state.profile.drinksBudgetUsd).toBe(40);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.state.profile.drinksBudgetUsd).toBe(40);
  });

  it("a clean legacy cache loaded offline takes the server's places and restrictions on the next online refresh", async () => {
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 3, state: { ...legacyRaw, favorites: ["local"], pets: [localPetRaw] }, dirty: false }),
    );
    await signIn("user_a", []);
    expect(store.getSnapshot().sync.status).toBe("offline");
    const server = fakeServer([
      { status: 200, json: { revision: 3, state: { ...serverState, pets: [serverPetWithRestrictions], places: serverPlaces } } },
    ]);
    store.configureStore({ fetch: server.fetch, timers });
    await store.retrySync();
    await settle();
    expect(server.calls.map((c) => c.method)).toEqual(["GET"]);
    const snap = store.getSnapshot();
    expect(snap.state.places).toEqual(serverPlaces);
    expect(snap.state.pets[0].restrictions).toEqual([{ kind: "chicken" }]);
    expect(snap.state.favorites).toEqual(["local"]);
    expect(snap.sync).toMatchObject({ status: "synced", revision: 3, dirty: false });
  });

  it("two overlapping pushes during legacy adoption make exactly one GET and one PUT", async () => {
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 3, state: { ...legacyRaw, favorites: ["local-edit"], pets: [localPetRaw] }, dirty: true }),
    );
    await signIn("user_a", []); // boot offline: legacy and dirty
    const server = fakeServer([
      { status: 200, json: { revision: 3, state: { ...serverState, pets: [serverPetWithRestrictions], places: serverPlaces } } },
      { status: 200, json: { revision: 4 } },
    ]);
    store.configureStore({ fetch: server.fetch, timers });
    await Promise.all([store.flush(), store.flush()]);
    await settle();
    expect(server.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(server.calls[1].body?.state.places).toEqual(serverPlaces);
    expect(server.calls[1].body?.state.favorites).toEqual(["local-edit"]);
    expect(store.getSnapshot().sync).toMatchObject({ status: "synced", revision: 4, dirty: false });
  });

  it("accepting pre-account data with a location creates its saved place before the first upload", async () => {
    storage.setItem(store.LEGACY_KEY, JSON.stringify({ ...onboarded, location: { label: "02143", zip: "02143" } }));
    const server = await signIn("user_a", [
      { status: 200, json: { revision: 0, state: null } },
      { status: 200, json: { revision: 1 } },
    ]);
    store.decideMigration(true);
    await settle();
    await settle();
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    const saved = puts[0].body?.state.places.saved ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ label: "02143", zip: "02143" });
    expect(puts[0].body?.state.places.activeId).toBe(saved[0].id);
  });

  it("placesFromLegacyLocation builds saved[0] from location and makes it active", () => {
    const state: AppState = {
      ...DEFAULT_STATE,
      location: { label: "02143", zip: "02143", city: "Somerville", state: "MA" },
    };
    const places = store.placesFromLegacyLocation(state);
    expect(places.saved).toHaveLength(1);
    expect(places.saved[0]).toMatchObject({ label: "02143", zip: "02143", city: "Somerville", state: "MA" });
    expect(places.saved[0].id).toMatch(/^loc_[a-z0-9]{8}$/);
    expect(places.activeId).toBe(places.saved[0].id);
  });

  it("placesFromLegacyLocation leaves places alone when there is no location or saved places already", () => {
    expect(store.placesFromLegacyLocation(DEFAULT_STATE)).toBe(DEFAULT_STATE.places);
    const withSaved: AppState = {
      ...DEFAULT_STATE,
      location: { label: "02143" },
      places: { saved: [place] },
    };
    expect(store.placesFromLegacyLocation(withSaved)).toBe(withSaved.places);
  });
});

describe("store: boot race", () => {
  it("an edit made while the boot GET is in flight is kept and pushed, not overwritten", async () => {
    storage.setItem(
      store.CACHE_PREFIX + "user_a",
      JSON.stringify({ revision: 1, state: { ...serverState, schema: 2 }, dirty: false }),
    );
    let releaseGet: (() => void) | undefined;
    const calls: Call[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Call["body"]) : undefined;
      calls.push({ method, body });
      if (method === "GET") {
        await new Promise<void>((r) => (releaseGet = r));
        return new Response(JSON.stringify({ revision: 1, state: serverState }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ revision: 2 }), { status: 200, headers: { "content-type": "application/json" } });
    });
    store.configureStore({ fetch, timers });
    store.setIdentity("user_a");
    await settle();
    // Edit before the GET resolves.
    const edited = store.saveState({ ...store.getSnapshot().state, favorites: ["mid-flight"] });
    expect(edited).toBe(true);
    releaseGet?.();
    await settle();
    await settle();
    runTimers();
    await settle();
    await settle();
    expect(store.getSnapshot().state.favorites).toEqual(["mid-flight"]);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body?.state.favorites).toEqual(["mid-flight"]);
  });
});

describe("store: reload flag", () => {
  it("a successful PUT clears the one-time reload flag", async () => {
    const session = new MemoryStorage();
    session.setItem(`cwym:reloaded:${STATE_SCHEMA_TAG}`, "1");
    vi.stubGlobal("window", {
      localStorage: storage,
      sessionStorage: session,
      location: { reload: vi.fn() },
      addEventListener() {},
      removeEventListener() {},
    });
    await signIn("user_a", [
      { status: 200, json: { revision: 0, state: null } },
      { status: 200, json: { revision: 1 } },
    ]);
    store.setAppState((s) => ({ ...s, favorites: ["x"] }));
    runTimers();
    await settle();
    await settle();
    expect(store.getSnapshot().sync.status).toBe("synced");
    expect(session.getItem(`cwym:reloaded:${STATE_SCHEMA_TAG}`)).toBeNull();
  });
});

describe("store: migrate backfills firstPlannedAt", () => {
  it("a schema-9 state with a plan reads back with firstPlannedAt set to plan.createdAt", () => {
    const raw: Record<string, unknown> = {
      ...DEFAULT_STATE,
      schema: 9,
      plan: { version: 1, createdAt: "2026-11-01T12:00:00.000Z", days: [{ dayIndex: 0, label: "Sun", meals: [] }], recipes: {} },
    };
    delete raw.firstPlannedAt;
    const parsed = AppStateSchema.parse(store.migrate(raw));
    expect(parsed.firstPlannedAt).toBe("2026-11-01T12:00:00.000Z");
    expect(parsed.schema).toBe(11);
  });
});

describe("an answer that arrives after another account signed in", () => {
  const arrived = { ...onboarded, favorites: ["A-private"] };

  it("is dropped, whether it is an update, a whole state or the save after it", async () => {
    await signIn("user_A", [{ status: 200, json: { revision: 1, state: serverState } }]);
    const b = await signIn("user_B", [{ status: 200, json: { revision: 1, state: onboarded } }]);
    store.setAppStateAs("user_A", (prev) => ({ ...prev, favorites: ["A-private"] }));
    store.setAppStateAs("user_A", arrived);
    expect(store.saveState(arrived)).toBe(false);
    await store.flush();
    expect(store.getSnapshot().state.favorites).toEqual([]);
    expect(store.getSnapshot().sync.dirty).toBe(false);
    expect(b.calls.filter((c) => c.method === "PUT")).toEqual([]);
    expect(storage.keys().map((k) => storage.getItem(k)).filter((v) => v?.includes("A-private"))).toEqual([]);
  });

  it("is dropped while nobody is signed in", async () => {
    await signIn("user_A", [{ status: 200, json: { revision: 1, state: onboarded } }]);
    store.setIdentity(null);
    store.setAppStateAs("user_A", arrived);
    expect(store.getSnapshot().state.favorites).toEqual([]);
    store.setAppStateAs(null, arrived);
    expect(store.saveState(arrived)).toBe(false);
    expect(store.getSnapshot().state.favorites).toEqual([]);
  });

  it("still lands when the same person is there", async () => {
    await signIn("user_A", [{ status: 200, json: { revision: 1, state: onboarded } }]);
    store.setIdentity(null);
    await signIn("user_A", [{ status: 200, json: { revision: 1, state: onboarded } }]);
    store.setAppStateAs("user_A", (prev) => ({ ...prev, favorites: ["mine"] }));
    expect(store.getSnapshot().state.favorites).toEqual(["mine"]);
  });
});

describe("a refusal meant for the previous account", () => {
  it("does not sign the new one out", async () => {
    let answer!: (r: Response) => void;
    store.configureStore({ fetch: () => new Promise<Response>((r) => { answer = r; }), timers });
    store.setIdentity("user_A");
    await settle();
    const late = answer;
    await signIn("user_B", [{ status: 200, json: { revision: 1, state: onboarded } }]);
    late(Response.json({ error: "other_account" }, { status: 403 }));
    await settle();
    await settle();
    expect(store.getIdentity()).toBe("user_B");
    expect(store.getSnapshot().hydrated).toBe(true);
  });

  it("nor the same person who came back meanwhile", async () => {
    let answer!: (r: Response) => void;
    store.configureStore({ fetch: () => new Promise<Response>((r) => { answer = r; }), timers });
    store.setIdentity("user_A");
    await settle();
    const late = answer;
    store.setIdentity(null);
    await signIn("user_A", [{ status: 200, json: { revision: 1, state: onboarded } }]);
    late(Response.json({ error: "other_account" }, { status: 403 }));
    await settle();
    await settle();
    expect(store.getIdentity()).toBe("user_A");
  });
});

describe("a document made for one account", () => {
  afterEach(() => void vi.mocked(documentAccount).mockReturnValue(null));

  it("never asks for anybody else's data, and says who is there", async () => {
    await signIn("user_B", [{ status: 200, json: { revision: 1, state: onboarded } }]); // leaves B's copy on the device
    expect(store.setOfflineIdentity("user_B")).toBe(true);
    const a = await signIn("user_A", [{ status: 200, json: { revision: 1, state: onboarded } }]);
    vi.mocked(documentAccount).mockReturnValue("user_A");
    const calls = a.calls.length;
    store.setIdentity("user_B");
    await settle();
    expect(store.getIdentity()).toBeNull();
    expect(store.getForeign()).toBe("user_B");
    expect(a.calls.length).toBe(calls);
    expect(store.setOfflineIdentity("user_B")).toBe(false);
    store.setIdentity("user_A");
    expect(store.getForeign()).toBeNull();
    expect(store.getIdentity()).toBe("user_A");
  });

  it("a person signed out is nobody else", () => {
    vi.mocked(documentAccount).mockReturnValue("user_A");
    store.setIdentity(null);
    expect(store.getForeign()).toBeNull();
  });
});
