import pricesJson from "../../data/prices.json";

// Two kinds of numbers live in data/prices.json: BLS national averages ("avg") and
// category estimates ("est."). Every displayed price says which one it is.
type Basis = "bls" | "estimate";

const entries = Object.entries(pricesJson.items as Record<string, { usd: number; basis: Basis }>).filter(
  ([, e]) => Number.isFinite(e.usd) && e.usd > 0,
);

// catalog key -> USD per package.
export const PRICES: Record<string, number> = Object.fromEntries(entries.map(([k, e]) => [k, e.usd]));

const BASIS: Record<string, Basis> = Object.fromEntries(entries.map(([k, e]) => [k, e.basis]));

export const AVG_SUFFIX = "(avg)";
export const EST_SUFFIX = "(est.)";

// Suffix for one catalog item: "(avg)" only when the number is a BLS average.
export function priceSuffix(key: string): string {
  return BASIS[key] === "bls" ? AVG_SUFFIX : EST_SUFFIX;
}

// "$5.90 (avg)" or "$5.90 (est.)". Without a key (totals, per serving) it is always an estimate.
export function formatAvg(usd: number, key?: string): string {
  return `$${usd.toFixed(2)} ${key ? priceSuffix(key) : EST_SUFFIX}`;
}

export function formatPerServingAvg(usd: number): string {
  return `$${usd.toFixed(2)} / serving ${EST_SUFFIX}`;
}

// Live store prices from /api/prices (Kroger). Only the fields the UI uses.
export type LivePrices = {
  store: { locationId: string; name: string };
  quotedAt: string;
  prices: Record<string, { regular: number; promo?: number; size: string }>;
};

export type PriceBasis = "store" | "avg" | "est" | "none";

// Per package. A store price wins when the live quote has the key (promo over regular);
// otherwise the BLS average or our estimate; otherwise no price.
export function priceFor(
  key: string,
  live?: LivePrices | null,
): { usd: number | null; basis: PriceBasis; promo?: number } {
  const quote = live?.prices[key];
  if (quote) {
    return {
      usd: quote.promo ?? quote.regular,
      basis: "store",
      ...(quote.promo !== undefined ? { promo: quote.promo } : {}),
    };
  }
  const usd = PRICES[key];
  if (typeof usd !== "number") return { usd: null, basis: "none" };
  return { usd, basis: priceSuffix(key) === AVG_SUFFIX ? "avg" : "est" };
}

// "$4.99 (King Soopers)", "$4.50 · sale $3.99 (King Soopers)", "$2.27 (avg)", "$1.10 (est.)". No usd: "no price".
// Store prices are shown as returned: `regular` is passed only so a sale can show both numbers.
export function formatPrice(usd: number | null, basis: PriceBasis, storeName?: string, regular?: number): string {
  if (usd === null || basis === "none") return "no price";
  if (basis === "store") {
    const name = storeName ?? "store";
    const onSale = regular !== undefined && usd < regular;
    return onSale
      ? `${formatMoney(regular)} · sale ${formatMoney(usd)} (${name})`
      : `${formatMoney(usd)} (${name})`;
  }
  return `$${usd.toFixed(2)} ${basis === "avg" ? AVG_SUFFIX : EST_SUFFIX}`;
}

// Store prices: two decimals only when the value has at most two decimals ("$4.50", "$3.99");
// otherwise the number exactly as Kroger returned it ("$1.234").
export function formatMoney(n: number): string {
  const cents = Math.round(n * 100);
  const twoDecimals = Number.isInteger(cents) && Math.abs(n * 100 - cents) < 1e-9;
  return `$${twoDecimals ? n.toFixed(2) : String(n)}`;
}

// Store price for a row when the header already names the store: "$3.99 sale (was $4.50)" or "$4.50".
export function formatStorePrice(usd: number, regular?: number): string {
  if (regular !== undefined && usd < regular) return `${formatMoney(usd)} sale (was ${formatMoney(regular)})`;
  return formatMoney(usd);
}

export const KROGER_NOTE ="Prices from Kroger, shown as returned; not cached.";

// The one muted source line on the shop pages.
export function krogerSourceLine(live: LivePrices): string {
  return `Prices from Kroger for ${live.store.name}, quoted ${quotedTime(live.quotedAt)}, shown as returned, not cached; tax and deposits not included.`;
}

// "Quoted 7:12 PM at King Soopers Table Mesa; tax and deposits not included."
export function quotedLine(live: LivePrices): string {
  const time = quotedTime(live.quotedAt);
  return `Quoted ${time} at ${live.store.name}; tax and deposits not included.`;
}

export function quotedTime(iso: string): string {
  // ICU may put a narrow no-break space before AM/PM; a plain space keeps the text copyable and matchable.
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\u202f/g, " ");
}
