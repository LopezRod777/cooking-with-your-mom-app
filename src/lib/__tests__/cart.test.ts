import { describe, expect, it } from "vitest";
import { buildGroceryList } from "../grocery";
import { PRICES } from "../prices";
import { buildCart, cartSubline, cartText, listKeys, lineCost, quantity, rowPrice } from "../cart";
import { KROGER_NOTE, formatPrice, quotedLine, type LivePrices } from "../prices";
import { makePlan, makeRecipe } from "./fixtures";

const plan = makePlan([
  {
    recipe: makeRecipe({
      id: "a",
      ingredients: [
        { key: "eggs", grams: 200, display: "4 eggs" },
        { key: "onion", grams: 50, display: "half an onion" },
      ],
    }),
  },
  {
    recipe: makeRecipe({
      id: "b",
      ingredients: [
        { key: "chicken_breast", grams: 700, display: "700 g chicken" },
        { key: "eggs", grams: 50, display: "1 egg" },
      ],
    }),
  },
]);

const allPriced = buildGroceryList(plan, { haveAtHome: [], prices: PRICES, mealDrinks: true });
const allItems = allPriced.aisles.flatMap((a) => a.items);
const keysOf = (cart: ReturnType<typeof buildCart>) => cart.aisles.flatMap((a) => a.items.map((i) => i.key));

describe("buildCart", () => {
  it("keeps only the checked keys", () => {
    const cart = buildCart(allPriced, ["eggs", "chicken_breast"]);
    expect(keysOf(cart).sort()).toEqual(["chicken_breast", "eggs"]);
    expect(cart.itemCount).toBe(2);
  });

  it("totals equal the sum of the checked estCostUsd", () => {
    const cart = buildCart(allPriced, ["eggs", "chicken_breast", "onion"]);
    const picked = allItems.filter((i) => ["eggs", "chicken_breast", "onion"].includes(i.key));
    const sum = Math.round(picked.reduce((s, i) => s + (i.estCostUsd ?? 0), 0) * 100) / 100;
    expect(cart.totals.estUsd).toBe(sum);
    const priced = picked.filter((i) => i.estCostUsd !== null).length;
    expect(cart.totals.byBasis.avg.count + cart.totals.byBasis.est.count).toBe(priced);
  });

  it("counts null prices as unpriced and sums only priced items", () => {
    const partial = buildGroceryList(plan, { haveAtHome: [], prices: { eggs: 2 }, mealDrinks: true });
    const cart = buildCart(partial, ["eggs", "onion"]);
    const eggs = partial.aisles.flatMap((a) => a.items).find((i) => i.key === "eggs")!;
    expect(eggs.estCostUsd).not.toBeNull();
    expect(cart.totals.byBasis.avg.count + cart.totals.byBasis.est.count).toBe(1);
    expect(cart.totals.missing).toBe(1);
    expect(cart.totals.estUsd).toBe(eggs.estCostUsd);
  });

  it("splits priced items into avg and est by basis", () => {
    const mixed = makePlan([
      {
        recipe: makeRecipe({
          id: "m",
          ingredients: [
            { key: "eggs", grams: 200, display: "4 eggs" },
            { key: "salmon", grams: 300, display: "300 g salmon" },
            { key: "onion", grams: 50, display: "half an onion" },
          ],
        }),
      },
    ]);
    const prices = { eggs: 3, salmon: 9 };
    const list = buildGroceryList(mixed, { haveAtHome: [], prices, mealDrinks: true });
    const items = list.aisles.flatMap((a) => a.items);
    const eggs = items.find((i) => i.key === "eggs")!;
    const salmon = items.find((i) => i.key === "salmon")!;
    const cart = buildCart(list, ["eggs", "salmon", "onion"]);
    expect(cart.totals.byBasis.avg).toEqual({ count: 1, usd: eggs.estCostUsd });
    expect(cart.totals.byBasis.est).toEqual({ count: 1, usd: salmon.estCostUsd });
    expect(cart.totals.missing).toBe(1);
    expect(cart.totals.estUsd).toBe(Math.round((eggs.estCostUsd! + salmon.estCostUsd!) * 100) / 100);
  });

  it("keeps the list's aisle order", () => {
    const cart = buildCart(allPriced, allItems.map((i) => i.key));
    expect(cart.aisles.map((a) => a.aisle)).toEqual(allPriced.aisles.map((a) => a.aisle));
    expect(keysOf(cart)).toEqual(allItems.map((i) => i.key));
  });

  it("empty checked gives no items and no total", () => {
    const cart = buildCart(allPriced, []);
    expect(cart.itemCount).toBe(0);
    expect(cart.totals.estUsd).toBeNull();
    expect(cart.aisles).toEqual([]);
  });
});

describe("cartText", () => {
  it("starts with the Cart line and lists aisles in order", () => {
    const cart = buildCart(allPriced, allItems.map((i) => i.key));
    const text = cartText(cart);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^Cart · \d+ items · ≈ \$\d+\.\d{2} \(est\.\)$/);
    expect(lines[0]).toContain(`${cart.itemCount} items`);
    const headers = cart.aisles.map((a) => a.aisle);
    const positions = headers.map((h) => lines.indexOf(h));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("omits the price part when the total is null", () => {
    const cart = buildCart(allPriced, []);
    expect(cartText(cart).split("\n")[0]).toBe("Cart · 0 items");
  });
});

const live: LivePrices = {
  store: { locationId: "01400943", name: "King Soopers Table Mesa" },
  quotedAt: "2026-10-31T19:12:00.000Z",
  prices: { eggs: { regular: 3, promo: 2.5, size: "12 ct" } },
};
const round2 = (n: number) => Math.round(n * 100) / 100;

describe("buildCart with a live store quote", () => {
  // eggs: live store price (promo). onion: est. chicken_breast: avg. Only eggs is store-priced.
  const checked = ["eggs", "onion", "chicken_breast"];
  const eggs = allItems.find((i) => i.key === "eggs")!;
  const onion = allItems.find((i) => i.key === "onion")!;
  const chicken = allItems.find((i) => i.key === "chicken_breast")!;
  const eggsStoreUsd = round2(2.5 * (eggs.packages ?? 1));

  it("prices store items from the live quote and splits the rest by basis", () => {
    const cart = buildCart(allPriced, checked, live);
    expect(cart.totals.byBasis.store).toEqual({ count: 1, usd: eggsStoreUsd });
    expect(cart.totals.byBasis.avg).toEqual({ count: 1, usd: chicken.estCostUsd });
    expect(cart.totals.byBasis.est).toEqual({ count: 1, usd: onion.estCostUsd });
    expect(cart.totals.missing).toBe(0);
    expect(cart.totals.estUsd).toBe(round2(eggsStoreUsd + chicken.estCostUsd! + onion.estCostUsd!));
  });

  it("marks only the store-priced items with storePrice (promo wins)", () => {
    const cart = buildCart(allPriced, checked, live);
    const items = cart.aisles.flatMap((a) => a.items);
    expect(items.find((i) => i.key === "eggs")?.storePrice).toEqual({ usd: 2.5, regular: 3, promo: 2.5 });
    expect(items.find((i) => i.key === "onion")?.storePrice).toBeUndefined();
    expect(items.find((i) => i.key === "chicken_breast")?.storePrice).toBeUndefined();
  });

  it("without a live quote the cart is unchanged", () => {
    const cart = buildCart(allPriced, checked, null);
    expect(cart.totals.byBasis.store).toEqual({ count: 0, usd: 0 });
    expect(cart.totals.byBasis.avg.count).toBe(2);
    expect(cart.aisles.flatMap((a) => a.items).some((i) => i.storePrice)).toBe(false);
  });

  it("subline lists store, avg and est parts with their counts", () => {
    const cart = buildCart(allPriced, checked, live);
    const expected = [
      `≈ $${cart.totals.estUsd!.toFixed(2)}`,
      `$${eggsStoreUsd.toFixed(2)} at King Soopers Table Mesa (1)`,
      `$${chicken.estCostUsd!.toFixed(2)} avg (1)`,
      `$${onion.estCostUsd!.toFixed(2)} est (1)`,
    ].join(" · ");
    expect(cartSubline(cart, live)).toBe(expected);
  });

  it("cartText header drops '(est.)' when part of the total is store-priced", () => {
    const cart = buildCart(allPriced, checked, live);
    const first = cartText(cart, { live }).split("\n")[0];
    expect(first).toBe(`Cart · ${cart.itemCount} items · ≈ $${cart.totals.estUsd!.toFixed(2)}`);
    expect(cartText(cart, { live }).split("\n")[1]).toContain("Quoted");
  });

  it("cartText header keeps '(est.)' when nothing is store-priced", () => {
    const cart = buildCart(allPriced, checked, null);
    expect(cartText(cart).split("\n")[0]).toMatch(/\(est\.\)$/);
  });

  it("subline omits zero parts and names missing prices", () => {
    const partial = buildGroceryList(plan, { haveAtHome: [], prices: { eggs: 2 }, mealDrinks: true });
    const cart = buildCart(partial, ["eggs", "onion"]);
    const eggsAvg = partial.aisles.flatMap((a) => a.items).find((i) => i.key === "eggs")!.estCostUsd!;
    expect(cartSubline(cart)).toBe(`≈ $${eggsAvg.toFixed(2)} · $${eggsAvg.toFixed(2)} avg (1) · 1 without a price`);
  });

  it("rowPrice shows the returned Kroger price per package, not multiplied", () => {
    expect(rowPrice(eggs, live)).toEqual({ usd: 2.5, basis: "store", regular: 3 });
    expect(rowPrice(onion, live)).toEqual(lineCost(onion, live));
  });

  it("listKeys returns the list's keys in order", () => {
    expect(listKeys(plan, [], true).sort()).toEqual(allItems.map((i) => i.key).sort());
    expect(listKeys(null, [], true)).toEqual([]);
  });

  it("cartText names the store when given, and Copy and Share get the same text", () => {
    const cart = buildCart(allPriced, checked, live);
    const text = cartText(cart, { live, storeName: live.store.name });
    expect(text.split("\n")[1]).toBe(`Store: ${live.store.name}`);
    expect(text).toContain("Prices from Kroger, shown as returned; not cached.");
    expect(text).toContain(`- ${eggs.displayName}: ${quantity(eggs)} · $3.00 · sale $2.50 (King Soopers Table Mesa)`);
    expect(text).toBe(cartText(cart, { live, storeName: live.store.name }));
  });

  it("cartText adds the quoted line and store prices when live", () => {
    const cart = buildCart(allPriced, checked, live);
    const lines = cartText(cart, { live }).split("\n");
    expect(lines[1]).toBe(quotedLine(live));
    expect(lines[2]).toBe(KROGER_NOTE);
    expect(cartText(cart, { live })).toContain(
      `- ${eggs.displayName}: ${quantity(eggs)} · $3.00 · sale $2.50 (King Soopers Table Mesa)`,
    );
    expect(cartText(buildCart(allPriced, checked, null))).not.toContain("Kroger");
    expect(cartText(buildCart(allPriced, checked, null))).not.toContain("Quoted");
  });
});
