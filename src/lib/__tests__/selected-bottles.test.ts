import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SELECTED_BOTTLES,
  addSelectedBottle,
  clearSelectedBottles,
  getSelectedBottles,
  isBottleListFull,
  removeSelectedBottle,
  toggleSelectedBottle,
} from "../../components/pairings/selectedBottles";
import { lock, unlock } from "../../components/pairings/usePairingsGate";

// The gate module imports Clerk's hook; these tests only call its plain functions.
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ sessionId: null }) }));

const bottle = (n: number) => ({ productId: String(n).padStart(13, "0"), styleId: "pinot-noir", storeId: "ks-table-mesa" });

beforeEach(() => {
  clearSelectedBottles();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearSelectedBottles();
});

describe("selected bottles (memory only)", () => {
  it("caps the list at 12 and refuses a 13th bottle", () => {
    expect(MAX_SELECTED_BOTTLES).toBe(12);
    for (let i = 1; i <= 12; i++) expect(addSelectedBottle(bottle(i).productId, bottle(i))).toBe(true);
    expect(getSelectedBottles().size).toBe(12);
    expect(isBottleListFull()).toBe(true);
    expect(addSelectedBottle(bottle(13).productId, bottle(13))).toBe(false);
    expect(getSelectedBottles().size).toBe(12);
  });

  it("re-adding a bottle already in a full list is allowed and does not grow the list", () => {
    for (let i = 1; i <= 12; i++) addSelectedBottle(bottle(i).productId, bottle(i));
    expect(addSelectedBottle(bottle(3).productId, bottle(3))).toBe(true);
    expect(getSelectedBottles().size).toBe(12);
  });

  it("toggle adds, then removes; a toggle on a full list does not add", () => {
    const b = bottle(1);
    expect(toggleSelectedBottle(b.productId, b)).toBe(true);
    expect(getSelectedBottles().get(b.productId)).toEqual(b);
    expect(toggleSelectedBottle(b.productId, b)).toBe(false);
    expect(getSelectedBottles().size).toBe(0);
    for (let i = 2; i <= 13; i++) addSelectedBottle(bottle(i).productId, bottle(i));
    expect(toggleSelectedBottle(bottle(99).productId, bottle(99))).toBe(false);
    expect(getSelectedBottles().size).toBe(12);
  });

  it("remove drops one bottle; clear empties the list", () => {
    addSelectedBottle(bottle(1).productId, bottle(1));
    addSelectedBottle(bottle(2).productId, bottle(2));
    removeSelectedBottle(bottle(1).productId);
    expect([...getSelectedBottles().keys()]).toEqual([bottle(2).productId]);
    clearSelectedBottles();
    expect(getSelectedBottles().size).toBe(0);
  });
});

describe("selected bottles are cleared when the gate closes", () => {
  it("lock() empties the selection before the server answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect(await unlock()).toBe(true);
    addSelectedBottle(bottle(1).productId, bottle(1));
    addSelectedBottle(bottle(2).productId, bottle(2));

    const pending = lock(); // the synchronous part closes the gate and clears the list
    expect(getSelectedBottles().size).toBe(0);
    await pending;
    expect(getSelectedBottles().size).toBe(0);
  });

  it("a lock whose server call fails still clears the selection", async () => {
    // Unlock succeeds; every lock attempt fails (the gate still closes on the client).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response("{}", { status: String(url).endsWith("/api/pair/lock") ? 500 : 200 })),
    );
    expect(await unlock()).toBe(true);
    addSelectedBottle(bottle(1).productId, bottle(1));
    await lock();
    expect(getSelectedBottles().size).toBe(0);
  });
});
