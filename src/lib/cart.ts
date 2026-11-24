import { CATALOG } from "./catalog";
import { buildGroceryList, type GroceryItem } from "./grocery";
import type { WeekPlan } from "./schemas";
import {
  AVG_SUFFIX,
  KROGER_NOTE,
  PRICES,
  formatAvg,
  formatMoney,
  formatPrice,
  priceFor,
  priceSuffix,
  quotedLine,
  type LivePrices,
  type PriceBasis,
} from "./prices";

type GroceryList = ReturnType<typeof buildGroceryList>;

// An item in the cart. storePrice is set only when the live quote priced it (per package).
export type CartItem = GroceryItem & { storePrice?: { usd: number; regular: number; promo?: number } };

export type Cart = {
  aisles: { aisle: string; items: CartItem[] }[];
  itemCount: number;
  totals: {
    estUsd: number | null;
    byBasis: {
      store: { count: number; usd: number };
      avg: { count: number; usd: number };
      est: { count: number; usd: number };
    };
    missing: number;
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Package label plus count, e.g. "2 × 1 lb". Shared by the shopping list and the cart.
export function quantity(item: GroceryItem): string {
  // Catalog may carry a packageLabel field (added by another agent); read it defensively.
  const label =
    (CATALOG[item.key] as { packageLabel?: string } | undefined)?.packageLabel ??
    item.packageLabel;
  return item.packages === null || item.packages === 1 ? label : `${item.packages} × ${label}`;
}

// Cost of one line (all packages). A store price is per package, so it is multiplied by the package
// count (1 when the count is unknown, which is how quantity() shows it). Otherwise the existing avg/est figure.
export function lineCost(item: GroceryItem, live?: LivePrices | null): { usd: number | null; basis: PriceBasis } {
  const p = priceFor(item.key, live);
  if (p.basis === "store" && p.usd !== null) {
    return { usd: round2(p.usd * (item.packages ?? 1)), basis: "store" };
  }
  if (item.estCostUsd === null) return { usd: null, basis: "none" };
  return { usd: item.estCostUsd, basis: priceSuffix(item.key) === AVG_SUFFIX ? "avg" : "est" };
}

// Grocery keys of a plan, in list order, for /api/prices?keys=. Empty without a plan.
export function listKeys(plan: WeekPlan | null | undefined, haveAtHome: string[], mealDrinks: boolean): string[] {
  if (!plan) return [];
  return buildGroceryList(plan, { haveAtHome, prices: PRICES, mealDrinks }).aisles.flatMap((a) => a.items.map((i) => i.key));
}

function withStorePrice(item: GroceryItem, live?: LivePrices | null): CartItem {
  const quote = live?.prices[item.key];
  if (!quote) return item;
  return {
    ...item,
    storePrice: {
      usd: quote.promo ?? quote.regular,
      regular: quote.regular,
      ...(quote.promo !== undefined ? { promo: quote.promo } : {}),
    },
  };
}

// The price for one row, as Kroger returned it (per package, never multiplied) when the store priced it;
// otherwise the line cost used for the totals.
export function rowPrice(
  item: GroceryItem,
  live?: LivePrices | null,
): { usd: number | null; basis: PriceBasis; regular?: number } {
  const quote = live?.prices[item.key];
  if (quote) return { usd: quote.promo ?? quote.regular, basis: "store", regular: quote.regular };
  return lineCost(item, live);
}

// Keeps only the checked items, in the list's aisle order. Totals split priced items by basis:
// "store" (live quote), "avg" (BLS average) or "est." (our guess), and count the items with no price.
export function buildCart(list: GroceryList, checked: string[], live?: LivePrices | null): Cart {
  const keep = new Set(checked);
  const aisles = list.aisles
    .map(({ aisle, items }) => ({
      aisle,
      items: items.filter((i) => keep.has(i.key)).map((i) => withStorePrice(i, live)),
    }))
    .filter((a) => a.items.length > 0);
  const items = aisles.flatMap((a) => a.items);

  const byBasis = {
    store: { count: 0, usd: 0 },
    avg: { count: 0, usd: 0 },
    est: { count: 0, usd: 0 },
  };
  let missing = 0;
  for (const item of items) {
    const cost = lineCost(item, live);
    if (cost.usd === null || cost.basis === "none") {
      missing += 1;
      continue;
    }
    const bucket = byBasis[cost.basis];
    bucket.count += 1;
    bucket.usd = round2(bucket.usd + cost.usd);
  }
  const pricedCount = byBasis.store.count + byBasis.avg.count + byBasis.est.count;
  const estUsd =
    pricedCount === 0 ? null : round2(byBasis.store.usd + byBasis.avg.usd + byBasis.est.usd);

  return { aisles, itemCount: items.length, totals: { estUsd, byBasis, missing } };
}

// Price part of the cart line, e.g. "≈ $84.00 · $51.00 at King Soopers Table Mesa (23) · $9.00 avg (4) ·
// $24.00 est (11) · 3 without a price". Zero parts are left out.
export function cartSubline(cart: Cart, live?: LivePrices | null): string {
  const { estUsd, byBasis, missing } = cart.totals;
  return [
    estUsd !== null ? `≈ $${estUsd.toFixed(2)}` : null,
    byBasis.store.count > 0 && live
      ? `${formatMoney(byBasis.store.usd)} at ${live.store.name} (${byBasis.store.count})`
      : null,
    byBasis.avg.count > 0 ? `$${byBasis.avg.usd.toFixed(2)} avg (${byBasis.avg.count})` : null,
    byBasis.est.count > 0 ? `$${byBasis.est.usd.toFixed(2)} est (${byBasis.est.count})` : null,
    missing > 0 ? `${missing} without a price` : null,
  ]
    .filter((p): p is string => p !== null)
    .join(" · ");
}

// Plain text for copy and share. First line is the summary; then one block per aisle.
export function cartText(
  cart: Cart,
  opts: { storeName?: string; live?: LivePrices | null } = {},
): string {
  const header = [
    `Cart · ${cart.itemCount} items`,
    cart.totals.estUsd !== null
      ? cart.totals.byBasis.store.count > 0
        ? `≈ $${cart.totals.estUsd.toFixed(2)}`
        : `≈ ${formatAvg(cart.totals.estUsd)}`
      : null,
  ]
    .filter((p): p is string => p !== null)
    .join(" · ");
  const lines = [header];
  if (opts.storeName) lines.push(`Store: ${opts.storeName}`);
  if (opts.live) lines.push(quotedLine(opts.live), KROGER_NOTE);

  const blocks = cart.aisles.map(({ aisle, items }) =>
    [
      aisle,
      ...items.map((i) => {
        const cost = rowPrice(i, opts.live);
        return `- ${i.displayName}: ${quantity(i)}${
          cost.usd !== null ? ` · ${formatPrice(cost.usd, cost.basis, opts.live?.store.name, cost.regular)}` : ""
        }`;
      }),
    ].join("\n"),
  );
  return [lines.join("\n"), ...blocks].join("\n\n");
}
