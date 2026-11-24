"use client";

import { useEffect, useState } from "react";
import { useAppState } from "@/lib/useAppState";
import { formatStorePrice, krogerSourceLine } from "@/lib/prices";
import { currentEpoch } from "@/components/pairings/usePairingsGate";
import { removeSelectedBottle, useSelectedBottles } from "@/components/pairings/selectedBottles";
import { Button } from "@/components/ui/Button";

// Drinks kept in mind on a pairing card. Shown only while the 21+ gate is open (CartPage decides that). Prices are
// quoted live on mount and on focus; nothing here is cached or stored.

type QuoteItem = { productId: string; description: string; brand: string | null; size: string | null; regular: number; promo: number | null };
type Store = { locationId: string; name: string };
type Quote =
  | { kind: "ok"; store: Store; quotedAt: string; items: QuoteItem[]; complete: boolean }
  | { kind: "unavailable" }
  | { kind: "gone" };

function itemOf(x: unknown): QuoteItem | null {
  const r = x as Record<string, unknown> | null;
  if (!r || typeof r.productId !== "string" || typeof r.description !== "string" || typeof r.regular !== "number") return null;
  return {
    productId: r.productId,
    description: r.description,
    brand: typeof r.brand === "string" ? r.brand : null,
    size: typeof r.size === "string" ? r.size : null,
    regular: r.regular,
    promo: typeof r.promo === "number" ? r.promo : null,
  };
}

async function fetchQuote(query: string): Promise<Quote> {
  let res: Response;
  try {
    res = await fetch(`/api/prices/drinks/quote?${query}`, { cache: "no-store" });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status === 403) return { kind: "gone" };
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json) return { kind: "unavailable" };
  if (json.kind !== "ok" && json.kind !== "none") return { kind: "unavailable" };
  const store = json.store as { locationId?: unknown; name?: unknown } | undefined;
  if (typeof store?.locationId !== "string" || typeof store.name !== "string") return { kind: "unavailable" };
  const items = Array.isArray(json.items) ? json.items.map(itemOf).filter((i): i is QuoteItem => i !== null) : [];
  return {
    kind: "ok",
    store: { locationId: store.locationId, name: store.name },
    quotedAt: typeof json.quotedAt === "string" ? json.quotedAt : new Date().toISOString(),
    items,
    complete: json.complete === true,
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function DrinksSection({ groceriesUsd }: { groceriesUsd: number | null }) {
  const [state, , hydrated] = useAppState();
  const selected = useSelectedBottles();
  const loc = state.places.activeId;
  const store = state.places.preferredStore;
  const storeId = store?.id;
  const budget = state.profile.drinksBudgetUsd;
  // Only bottles picked at the store that is preferred now; picks from another store are not quoted here.
  const ids = [...selected].filter(([, b]) => b.storeId === storeId).map(([id]) => id);
  const idsKey = ids.join(",");
  const req = hydrated && loc && storeId && ids.length > 0 ? `${loc}|${storeId}|${idsKey}` : null;
  const [load, setLoad] = useState<{ req: string; quote: Quote } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!req || !loc || !storeId) return;
    const r = req;
    const epoch = currentEpoch();
    let alive = true;
    const query = `loc=${encodeURIComponent(loc)}&store=${encodeURIComponent(storeId)}&productIds=${encodeURIComponent(idsKey)}`;
    void fetchQuote(query).then((quote) => {
      // A lock (or a newer request) in the meantime: the late answer is dropped.
      if (alive && epoch === currentEpoch()) setLoad({ req: r, quote });
    });
    return () => {
      alive = false;
    };
  }, [req, loc, storeId, idsKey, tick]);

  if (!req || !store) return null;
  const quote = load?.req === req ? load.quote : null;
  if (quote?.kind === "gone") return null;
  if (quote === null) {
    return (
      <p role="status" className="text-[17px] text-muted">
        Checking {store.name}…
      </p>
    );
  }

  const found = new Map(quote.kind === "ok" ? quote.items.map((i) => [i.productId, i]) : []);
  const complete = quote.kind === "ok" && quote.complete;
  const pricedUsd = [...found.values()].reduce((sum, i) => sum + (i.promo ?? i.regular), 0);
  const drinksText = found.size > 0 ? money(Math.round(pricedUsd * 100) / 100) : "no price";
  const groceriesText = groceriesUsd === null ? "no price" : money(groceriesUsd);

  return (
    <section aria-labelledby="drinks-title" className="grid gap-4 rounded-[28px] bg-panel p-3">
      <div className="grid gap-4 rounded-[20px] bg-paper p-5">
        <h2 id="drinks-title" className="text-[15px] font-bold uppercase tracking-[0.12em] text-basil-text">
          Drinks (21+)
        </h2>
        {quote.kind === "ok" && <p className="text-[15px] leading-snug text-muted">{krogerSourceLine({ store: quote.store, quotedAt: quote.quotedAt, prices: {} })}</p>}
        <ul>
          {ids.map((id) => {
            const item = found.get(id);
            return (
              <li key={id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
                {item ? (
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="break-words text-[18px] leading-snug">{item.description}</span>
                    {item.brand && <span className="break-words text-[15px] leading-snug text-muted">{item.brand}</span>}
                    <span className="text-[15px] text-muted">
                      {item.size ? `${item.size} · ` : ""}
                      {formatStorePrice(item.promo ?? item.regular, item.promo !== null ? item.regular : undefined)}
                    </span>
                  </div>
                ) : (
                  <span className="min-w-0 flex-1 text-[17px] text-muted">
                    {quote.kind === "ok" ? "Not listed at this store right now." : "Price unavailable right now."}
                  </span>
                )}
                <Button variant="ghost" size="md" className="min-h-11 px-4 text-[16px]" onClick={() => removeSelectedBottle(id)}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-1 text-[17px] leading-snug">
          <p className="font-semibold">
            Groceries {groceriesText} · Drinks {drinksText}
          </p>
          {complete && budget !== null && (
            <p>
              {money(Math.round(pricedUsd * 100) / 100)} of ${budget} drinks budget
            </p>
          )}
          {!complete && <p className="text-muted">Drinks total incomplete</p>}
        </div>
        <p className="text-[15px] leading-snug text-muted">Kept only while pairings are unlocked.</p>
      </div>
    </section>
  );
}
