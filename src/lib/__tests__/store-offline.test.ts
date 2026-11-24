// No-signal mode (setOfflineIdentity) and two tabs on one cache. No network: fetch is scripted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE, Profile, type AppState } from "../schemas";
import * as store from "../store";

const base: AppState = { ...DEFAULT_STATE, profile: Profile.parse({ version: 1, onboarded: true }), checked: [] };
const KEY = store.CACHE_PREFIX + "user_a";

let data: Map<string, string>;
let handlers: Map<string, Array<(e: unknown) => void>>;
let calls: Array<{ method: string; user?: string; body?: { baseRevision: number; state: AppState } }>;
let answers: Array<{ status: number; json: unknown }>;
const pending: Array<() => void> = [];
const timers = {
  setTimeout: ((fn: () => void) => pending.push(fn) as unknown as ReturnType<typeof setTimeout>) as typeof setTimeout,
  clearTimeout: (() => { pending.length = 0; }) as typeof clearTimeout,
};
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const runTimers = async () => { for (const fn of pending.splice(0)) fn(); await settle(); };
const fire = async (type: string, e: unknown = {}) => { for (const h of handlers.get(type) ?? []) h(e); await settle(); };
const seed = (revision: number, state: AppState, dirty: boolean, sent: string | null = null) => data.set(KEY, JSON.stringify({ revision, state, dirty, sent }));
const disk = () => JSON.parse(data.get(KEY)!) as { revision: number; dirty: boolean; state: AppState };
const puts = () => calls.filter((c) => c.method === "PUT");

beforeEach(() => {
  data = new Map();
  handlers = new Map();
  calls = [];
  answers = [];
  const localStorage = {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
  vi.stubGlobal("window", {
    localStorage,
    addEventListener: (t: string, h: (e: unknown) => void) => handlers.set(t, [...(handlers.get(t) ?? []), h]),
    removeEventListener() {},
  });
  store._resetStoreForTests();
  store.configureStore({
    timers,
    fetch: async (_url, init) => {
      calls.push({ method: init?.method ?? "GET", user: new Headers(init?.headers).get("x-cwym-user") ?? undefined, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const next = answers.shift();
      if (!next) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(next.json), { status: next.status, headers: { "content-type": "application/json" } });
    },
  });
});

afterEach(() => {
  store._resetStoreForTests();
  vi.unstubAllGlobals();
});

describe("no-signal mode", () => {
  it("opens the cached copy at once and never calls the server, whatever happens", async () => {
    seed(4, base, false);
    expect(store.setOfflineIdentity("user_a")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ hydrated: true, sync: { status: "offline", revision: 4 } });
    for (const key of ["eggs", "rice", "milk", "lime", "salt"]) store.setAppState((p) => ({ ...p, checked: [...p.checked, key] }));
    await store.flush();
    await store.retrySync();
    await runTimers();
    await fire("online");
    await fire("focus");
    expect(calls).toHaveLength(0);
    expect(disk()).toMatchObject({ revision: 4, dirty: true });
    expect(disk().state.checked).toEqual(["eggs", "rice", "milk", "lime", "salt"]);
  });

  it("a legacy cache does not adopt server fields either", async () => {
    data.set(KEY, JSON.stringify({ revision: 2, state: { ...base, pets: undefined }, dirty: true }));
    store.setOfflineIdentity("user_a");
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    await store.flush();
    expect(calls).toHaveLength(0);
  });

  it("no cache for that account: false, nothing hydrated", () => {
    expect(store.setOfflineIdentity("user_a")).toBe(false);
    expect(store.getSnapshot().hydrated).toBe(false);
  });

  it("Clerk confirming the same account afterwards boots for real and pushes what was edited", async () => {
    seed(4, base, false);
    store.setOfflineIdentity("user_a");
    store.setAppState((p) => ({ ...p, checked: ["eggs", "rice"] }));
    answers = [{ status: 200, json: { revision: 4, state: base } }, { status: 200, json: { revision: 5 } }];
    store.setIdentity("user_a");
    await settle();
    expect(puts()).toHaveLength(1);
    expect(puts()[0].body).toMatchObject({ baseRevision: 4, state: { checked: ["eggs", "rice"] } });
    expect(store.getSnapshot().sync).toMatchObject({ dirty: false, revision: 5, conflict: null });
  });

  it("the server moved meanwhile: a conflict to decide, and the edits are still there", async () => {
    seed(4, base, false);
    store.setOfflineIdentity("user_a");
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    answers = [{ status: 200, json: { revision: 6, state: { ...base, favorites: ["other-device"] } } }];
    store.setIdentity("user_a");
    await settle();
    expect(puts()).toHaveLength(0);
    expect(store.getSnapshot().sync.status).toBe("conflict");
    expect(store.getSnapshot().state.checked).toEqual(["eggs"]);
  });

  it("an expired session on the way back (401 twice) keeps the edits and stays dirty", async () => {
    seed(4, base, false);
    store.setOfflineIdentity("user_a");
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    answers = [{ status: 401, json: {} }, { status: 401, json: {} }];
    store.setIdentity("user_a");
    await settle();
    await runTimers();
    expect(puts()).toHaveLength(0);
    expect(disk()).toMatchObject({ dirty: true, state: { checked: ["eggs"] } });
  });

  it("another account signing in never sees the first one's copy", async () => {
    seed(4, { ...base, favorites: ["secret"] }, true);
    store.setOfflineIdentity("user_a");
    answers = [{ status: 200, json: { revision: 0, state: null } }];
    store.setIdentity("user_b");
    await settle();
    expect(store.getSnapshot().state.favorites).toEqual([]);
    expect(puts()).toHaveLength(0);
    expect(disk().state.favorites).toEqual(["secret"]);
  });

  it("the remembered account is forgotten on sign out", () => {
    seed(4, base, false);
    store.rememberUser("user_a");
    expect(store.readLastUser()).toBe("user_a");
    store.setOfflineIdentity("user_a");
    store.forgetLocalCache();
    expect(store.readLastUser()).toBeNull();
    expect(data.has(KEY)).toBe(false);
  });
});

describe("sign out", () => {
  it("an answer that was in flight does not write the copy back", async () => {
    answers = [{ status: 200, json: { revision: 4, state: { ...base, favorites: ["secret"] } } }];
    store.setIdentity("user_a"); // GET in flight
    expect(store.mediaOwner()).toBe("user_a");
    store.forgetLocalCache();
    expect(store.mediaOwner()).toBeNull(); // no photo download may start or finish
    await settle();
    expect(data.has(KEY)).toBe(false);
    answers = [{ status: 200, json: { revision: 4, state: base } }];
    store.setIdentity(null);
    store.setIdentity("user_a");
    await settle();
    expect(data.has(KEY)).toBe(true);
  });
});

describe("two tabs on one cache", () => {
  async function openClean() {
    seed(4, base, false);
    answers = [{ status: 200, json: { revision: 4, state: base } }];
    store.setIdentity("user_a");
    await settle();
  }

  it("a storage event from the other tab is taken without pushing", async () => {
    await openClean();
    seed(4, { ...base, checked: ["eggs"] }, true);
    await fire("storage", { key: KEY, newValue: data.get(KEY) });
    expect(store.getSnapshot().state.checked).toEqual(["eggs"]);
    expect(puts()).toHaveLength(0);
  });

  it("waking up takes a missed dirty copy and pushes it, instead of overwriting it with the server's", async () => {
    await openClean();
    seed(4, { ...base, checked: ["eggs"] }, true); // written by the no-signal tab while this one was frozen
    answers = [{ status: 200, json: { revision: 5 } }];
    await fire("online");
    expect(puts()).toHaveLength(1);
    expect(puts()[0].body?.state.checked).toEqual(["eggs"]);
    expect(disk()).toMatchObject({ revision: 5, dirty: false, state: { checked: ["eggs"] } });
  });

  it("both tabs pushed the same copy: the 409 with identical content is not a conflict", async () => {
    await openClean();
    const edited = { ...base, checked: ["eggs"] };
    seed(4, edited, true);
    answers = [{ status: 409, json: { revision: 5, state: edited } }];
    await fire("online");
    expect(store.getSnapshot().sync).toMatchObject({ conflict: null, revision: 5, dirty: false });
  });

  it("other accounts' keys are ignored", async () => {
    await openClean();
    await fire("storage", { key: store.CACHE_PREFIX + "user_b", newValue: "{}" });
    expect(store.getSnapshot().hydrated).toBe(true);
    expect(store.getSnapshot().state.checked).toEqual([]);
  });

  it("signed out from another tab: this one lets go and writes nothing back", async () => {
    await openClean();
    data.delete(KEY);
    await fire("storage", { key: KEY, newValue: null });
    expect(store.getIdentity()).toBeNull();
    expect(store.getSnapshot().hydrated).toBe(false);
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    await store.flush();
    expect(data.has(KEY)).toBe(false);
    expect(puts()).toHaveLength(0);
  });

  it("someone else signed in from another tab: this one lets go", async () => {
    await openClean();
    store.rememberUser("user_b");
    await fire("storage", { key: store.LAST_USER_KEY, newValue: "user_b" });
    expect(store.getIdentity()).toBeNull();
    expect(store.getSnapshot().state.checked).toEqual([]);
  });

  it("every read and write says whose data this tab holds", async () => {
    await openClean();
    answers = [{ status: 200, json: { revision: 5 } }];
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    await store.flush();
    expect(calls.map((c) => [c.method, c.user])).toEqual([["GET", "user_a"], ["PUT", "user_a"]]);
  });

  it("the cookie is another account's (403): nothing is taken, the edit stays", async () => {
    await openClean();
    answers = [{ status: 403, json: { error: "other_account" } }];
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    await store.flush();
    expect(disk()).toMatchObject({ revision: 4, dirty: true, state: { checked: ["eggs"] } });
    expect(store.getIdentity()).toBeNull(); // and the screen lets go of this account
  });

  // What the other tab wrote to disk before its storage event reached this one.
  const other = (state: AppState, edits: Record<string, number> = { other: 1 }, dirty = true, revision = 4) =>
    data.set(KEY, JSON.stringify({ revision, state, dirty, sent: null, edits }));

  it("an edit lands on top of the other tab's unannounced one", async () => {
    await openClean();
    other({ ...base, checked: ["eggs"] });
    store.setAppState((p) => ({ ...p, checked: [...p.checked, "rice"] }));
    expect(disk().state.checked).toEqual(["eggs", "rice"]);
  });

  it("a whole-state write keeps the fields the other tab changed", async () => {
    await openClean();
    const mine = { ...store.getSnapshot().state, favorites: ["soup"] };
    other({ ...base, checked: ["eggs"] });
    store.setAppState(mine);
    expect(disk().state).toMatchObject({ checked: ["eggs"], favorites: ["soup"] });
  });

  it("saveState right after setAppState, as Settings does, does not undo the other tab's edit", async () => {
    await openClean();
    const next = { ...store.getSnapshot().state, haveAtHome: ["rice"] };
    other({ ...base, favorites: ["soup"] });
    store.setAppState(next);
    store.saveState(next);
    expect(disk().state).toMatchObject({ favorites: ["soup"], haveAtHome: ["rice"] });
  });

  it("a tab closed mid-PUT whose answer never came: the next tab's edit goes on top, no false conflict", async () => {
    const E1 = { ...base, checked: ["eggs"] };
    seed(4, E1, true, store.fingerprintForTests(E1));
    store.setOfflineIdentity("user_a"); // loads dirty, as a tab that adopted it
    const E2 = { ...E1, checked: ["eggs", "rice"] };
    answers = [{ status: 200, json: { revision: 4, state: base } }, { status: 409, json: { revision: 5, state: E1 } }, { status: 200, json: { revision: 6 } }];
    store.setAppState(E2);
    store.setIdentity("user_a");
    await settle();
    await runTimers();
    expect(store.getSnapshot().sync.conflict).toBeNull();
    expect(puts().map((c) => c.body?.baseRevision)).toEqual([4, 5]);
    expect(puts()[1].body?.state.checked).toEqual(["eggs", "rice"]);
  });

  it("a late 409 after the other tab moved further is not a conflict", async () => {
    await openClean();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    answers = [{ status: 409, json: { revision: 5, state: { ...base, checked: ["eggs"], favorites: ["x"] } } }, { status: 200, json: { revision: 6 } }];
    const sending = store.flush();
    const mine = JSON.parse(data.get(KEY)!) as { edits: Record<string, number>; state: AppState };
    other({ ...mine.state, favorites: ["x", "y"] }, { ...mine.edits, other: 2 }, true, 5);
    await sending;
    expect(store.getSnapshot().sync.conflict).toBeNull();
    await runTimers();
    expect(puts()[1].body).toMatchObject({ baseRevision: 5, state: { favorites: ["x", "y"], checked: ["eggs"] } });
  });

  it("a 409 does not replace a pending choice between tabs", async () => {
    await openClean();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    answers = [{ status: 409, json: { revision: 5, state: { ...base, favorites: ["server"] } } }];
    const sending = store.flush();
    other({ ...base, favorites: ["soup"] });
    await sending;
    expect(store.getSnapshot().sync.conflict).toMatchObject({ local: true, state: { favorites: ["soup"] } });
    expect(disk().state.favorites).toEqual(["soup"]);
  });

  it("reloading with the choice pending asks again, with and without signal", async () => {
    const session = new Map<string, string>();
    (globalThis as unknown as { window: { sessionStorage: unknown } }).window.sessionStorage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => session.set(k, v), removeItem: (k: string) => session.delete(k) };
    await diverge();
    store.setIdentity(null);
    store.setOfflineIdentity("user_a");
    expect(store.getSnapshot()).toMatchObject({ state: { checked: ["eggs"] }, sync: { conflict: { local: true, state: { favorites: ["soup"] } } } });
    store.setIdentity(null);
    store.setIdentity("user_a");
    await settle();
    expect(store.getSnapshot().sync.conflict).toMatchObject({ local: true });
    store.resolveConflict("mine");
    expect(disk().state.checked).toEqual(["eggs"]);
  });

  it("storage full and freed later: the other tab's edit is not overwritten", async () => {
    await openClean();
    const ls = (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window.localStorage;
    const works = ls.setItem;
    ls.setItem = () => { throw new Error("QuotaExceededError"); };
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    ls.setItem = works;
    other({ ...base, favorites: ["soup"] });
    store.setAppState((p) => ({ ...p, checked: [...p.checked, "milk"] }));
    expect(store.getSnapshot().sync.conflict).toMatchObject({ local: true });
    expect(disk().state.favorites).toEqual(["soup"]);
  });

  async function diverge() {
    await openClean();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    other({ ...base, favorites: ["soup"] }); // edited at the same instant, without this tab's edit
    await fire("storage", { key: KEY, newValue: data.get(KEY) });
  }

  it("both edited at the same instant: a conflict, nothing dropped", async () => {
    await diverge();
    expect(store.getSnapshot().sync.conflict).toMatchObject({ local: true, state: { favorites: ["soup"] } });
    expect(store.getSnapshot().state.checked).toEqual(["eggs"]);
    await runTimers();
    expect(puts()).toHaveLength(0);
  });

  it("keeping this tab's version pushes it, and the other tab takes it without asking again", async () => {
    await diverge();
    answers = [{ status: 200, json: { revision: 5 } }];
    store.resolveConflict("mine");
    const written = JSON.parse(data.get(KEY)!) as { edits: Record<string, number> };
    expect(written.edits.other).toBe(1);
    await runTimers();
    expect(puts()[0].body?.state.checked).toEqual(["eggs"]);
  });

  it("taking the other tab's version backs up this one and pushes theirs", async () => {
    await diverge();
    answers = [{ status: 200, json: { revision: 5 } }];
    store.resolveConflict("theirs");
    expect([...data].some(([k, v]) => k.startsWith(store.BACKUP_PREFIX) && v.includes("eggs"))).toBe(true);
    await runTimers();
    expect(puts()[0].body?.state).toMatchObject({ favorites: ["soup"], checked: [] });
  });

  it("editing while the two versions wait keeps the other one intact", async () => {
    await diverge();
    store.setAppState((p) => ({ ...p, checked: [...p.checked, "rice"] }));
    expect(disk().state).toMatchObject({ favorites: ["soup"], checked: [] });
    expect([...data].some(([k, v]) => k.includes(":tab-") && v.includes("rice"))).toBe(true);
    store.resolveConflict("theirs");
    expect(store.getSnapshot().state).toMatchObject({ favorites: ["soup"], checked: [] });
    expect([...data.keys()].some((k) => k.includes(":tab-"))).toBe(false);
  });

  it("an unannounced version found on the next edit is not erased by that edit either", async () => {
    await openClean();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    other({ ...base, favorites: ["soup"] });
    store.setAppState((p) => ({ ...p, checked: [...p.checked, "rice"] }));
    expect(disk().state.favorites).toEqual(["soup"]);
    expect(store.getSnapshot().sync.conflict).toMatchObject({ local: true });
    store.resolveConflict("mine");
    expect(disk().state.checked).toEqual(["eggs", "rice"]);
  });

  it("another tab's edit made while a PUT was away survives its answer and goes up", async () => {
    await openClean();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    answers = [{ status: 200, json: { revision: 5 } }, { status: 200, json: { revision: 6 } }];
    const sending = store.flush();
    const mine = JSON.parse(data.get(KEY)!) as { edits: Record<string, number>; state: AppState };
    other({ ...mine.state, checked: ["eggs", "rice"] }, { ...mine.edits, other: 1 });
    await sending;
    await runTimers();
    expect(puts().map((c) => [c.body?.baseRevision, c.body?.state.checked.length])).toEqual([[4, 1], [5, 2]]);
    expect(disk()).toMatchObject({ dirty: false, revision: 6, state: { checked: ["eggs", "rice"] } });
  });

  it("flush sends what another tab left on disk unannounced (sign out must not erase it)", async () => {
    await openClean();
    other({ ...base, checked: ["rice"] });
    answers = [{ status: 200, json: { revision: 5 } }];
    await store.flush();
    expect(puts()[0].body?.state.checked).toEqual(["rice"]);
  });

  it("two flushes during one PUT do not send it twice", async () => {
    await openClean();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    answers = [{ status: 200, json: { revision: 5 } }];
    await Promise.all([store.flush(), store.flush()]);
    await runTimers();
    expect(puts()).toHaveLength(1);
  });

  it("different fields of the profile merge; the same one asks", async () => {
    await openClean();
    const now = store.getSnapshot().state;
    other({ ...base, profile: { ...base.profile, weeklyBudgetUsd: 80 } });
    store.setAppState({ ...now, profile: { ...now.profile, daysToPlan: 7 } });
    expect(disk().state.profile).toMatchObject({ weeklyBudgetUsd: 80, daysToPlan: 7 });
    const later = store.getSnapshot().state;
    other({ ...later, profile: { ...later.profile, daysToPlan: 3 } }, { ...(JSON.parse(data.get(KEY)!) as { edits: Record<string, number> }).edits, other: 2 });
    store.setAppState({ ...later, profile: { ...later.profile, daysToPlan: 5 } });
    expect(store.getSnapshot().sync.conflict).toMatchObject({ local: true });
    expect(store.getSnapshot().state.profile.daysToPlan).toBe(5);
    expect(disk().state.profile.daysToPlan).toBe(3);
  });

  it("a conflict with the server decided in the other tab goes away here too", async () => {
    await openClean();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    answers = [{ status: 409, json: { revision: 6, state: { ...base, favorites: ["phone"] } } }];
    await store.flush();
    expect(store.getSnapshot().sync.status).toBe("conflict");
    const mine = JSON.parse(data.get(KEY)!) as { edits: Record<string, number>; state: AppState };
    other(mine.state, { ...mine.edits, other: 1 }, true, 6);
    await fire("storage", { key: KEY, newValue: data.get(KEY) });
    expect(store.getSnapshot().sync.conflict).toBeNull();
  });

  it("pushed and edited again elsewhere while starting: no false conflict with the older answer", async () => {
    seed(4, base, false);
    answers = [{ status: 200, json: { revision: 4, state: base } }, { status: 200, json: { revision: 6 } }];
    store.setIdentity("user_a");
    other({ ...base, checked: ["eggs", "rice"] }, { other: 2 }, true, 5);
    await settle();
    expect(store.getSnapshot().sync.conflict).toBeNull();
    expect(puts()[0].body).toMatchObject({ baseRevision: 5, state: { checked: ["eggs", "rice"] } });
  });

  it("the other tab already sent this tab's edit: taken, no conflict", async () => {
    await openClean();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    const mine = JSON.parse(data.get(KEY)!) as { edits: Record<string, number>; state: AppState };
    other({ ...mine.state, favorites: ["soup"] }, { ...mine.edits, other: 1 }, false, 6);
    await fire("storage", { key: KEY, newValue: data.get(KEY) });
    expect(store.getSnapshot().sync).toMatchObject({ conflict: null, dirty: false, revision: 6 });
  });

  it("the other tab wrote while this one was starting: its copy wins over the older answer", async () => {
    answers = [{ status: 200, json: { revision: 0, state: null } }];
    store.setIdentity("user_a");
    other({ ...base, checked: ["eggs"] }, { other: 1 }, true, 0);
    answers.push({ status: 200, json: { revision: 1 } });
    await settle();
    expect(store.getSnapshot().state.checked).toEqual(["eggs"]);
    expect(puts()[0].body?.state.checked).toEqual(["eggs"]);
  });

  it("the other tab pushed while this one was starting: an older answer does not rewind it", async () => {
    seed(4, base, false);
    answers = [{ status: 200, json: { revision: 4, state: base } }];
    store.setIdentity("user_a");
    other({ ...base, checked: ["eggs"] }, { other: 1 }, false, 5);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ state: { checked: ["eggs"] }, sync: { revision: 5, dirty: false } });
  });
});

describe("storage full", () => {
  it("an edit too big for the disk survives Clerk coming back, and goes up", async () => {
    seed(4, base, false);
    store.setOfflineIdentity("user_a");
    const ls = (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window.localStorage;
    ls.setItem = () => { throw new Error("QuotaExceededError"); };
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    expect(store.getSnapshot().saveError).toBe("QuotaExceededError");
    answers = [{ status: 200, json: { revision: 4, state: base } }, { status: 200, json: { revision: 5 } }];
    store.setIdentity("user_a");
    await settle();
    expect(store.getSnapshot().sync.conflict).toBeNull();
    expect(puts()[0].body?.state.checked).toEqual(["eggs"]);
  });
});

describe("storage full, and the server does not answer either", () => {
  it("still says the edit is not on the device", async () => {
    seed(4, base, false);
    store.setOfflineIdentity("user_a");
    (globalThis as unknown as { window: { localStorage: { setItem: () => void } } }).window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    store.setIdentity("user_a");
    await settle();
    expect(store.getSnapshot()).toMatchObject({ saveError: "QuotaExceededError", sync: { dirty: true }, state: { checked: ["eggs"] } });
  });
});

describe("storage full, and another tab signs out", () => {
  it("an edit made while a PUT was already away is sent too", async () => {
    seed(4, base, false);
    answers = [{ status: 200, json: { revision: 4, state: base } }];
    store.setIdentity("user_a");
    await settle();
    const ls = (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window.localStorage;
    ls.setItem = () => { throw new Error("QuotaExceededError"); };
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    answers = [{ status: 200, json: { revision: 5 } }, { status: 200, json: { revision: 6 } }];
    void store.flush();
    store.setAppState((p) => ({ ...p, checked: ["eggs", "rice"] }));
    data.delete(KEY);
    await fire("storage", { key: KEY, newValue: null });
    await settle();
    expect(puts().map((c) => c.body?.state.checked.length)).toEqual([1, 2]);
    expect(store.getIdentity()).toBeNull();
  });

  it("sends the edit before letting go, and writes nothing back", async () => {
    seed(4, base, false);
    answers = [{ status: 200, json: { revision: 4, state: base } }];
    store.setIdentity("user_a");
    await settle();
    const ls = (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window.localStorage;
    const works = ls.setItem;
    ls.setItem = () => { throw new Error("QuotaExceededError"); };
    store.setAppState((p) => ({ ...p, checked: ["eggs"] }));
    ls.setItem = works; // the other tab's sign out freed the space
    data.delete(KEY);
    answers = [{ status: 200, json: { revision: 5 } }];
    await fire("storage", { key: KEY, newValue: null });
    expect(puts()[0].body?.state.checked).toEqual(["eggs"]);
    expect(store.getIdentity()).toBeNull();
    expect(data.has(KEY)).toBe(false);
  });
});

describe("identity change with a PUT in flight", () => {
  it("the old PUT's end does not open the door to two at once", async () => {
    seed(4, base, false);
    const gates: Array<() => void> = [];
    let live = 0, most = 0;
    store.configureStore({ fetch: async (_u, init) => {
      if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ revision: 4, state: base }), { status: 200 });
      calls.push({ method: "PUT" });
      const mine = gates.length >= 1;
      if (mine) most = Math.max(most, ++live);
      await new Promise<void>((r) => gates.push(r));
      if (mine) live--;
      return new Response(JSON.stringify({ revision: 5 }), { status: 200 });
    } });
    store.setIdentity("user_a"); await settle();
    store.setAppState((p) => ({ ...p, checked: ["eggs"] })); void store.flush(); await settle();
    store.setIdentity(null); store.setIdentity("user_a"); await settle(); // boots dirty: second PUT
    expect(gates).toHaveLength(2);
    gates[0](); await settle();
    store.setAppState((p) => ({ ...p, checked: ["eggs", "rice"] })); void store.flush(); await settle();
    expect(most).toBe(1);
    expect(store.getSnapshot().sync.dirty).toBe(true);
    for (const g of gates) g();
  });
});

describe("at the door", () => {
  it("signing out with no account loaded forgets the remembered one", () => {
    seed(4, base, false);
    store.rememberUser("user_a");
    store.forgetLocalCache();
    expect(data.has(KEY)).toBe(false);
    expect(store.readLastUser()).toBeNull();
  });
});
