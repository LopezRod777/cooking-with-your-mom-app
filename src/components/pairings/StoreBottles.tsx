"use client";

import { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/useAppState";
import { formatStorePrice } from "@/lib/prices";
import { searchTermFor } from "@/lib/pairings/vocab";
import { currentEpoch } from "./usePairingsGate";
import { isBottleListFull, toggleSelectedBottle, useSelectedBottles } from "./selectedBottles";

// Shelf rows from /api/prices/drinks for one style in the preferred store (Kroger only). Not cached: a quote lives
// in this component's state and goes away with it. Answers that arrive after the gate moved are discarded.

const SHOWN = 3;
const MAX_PENDING_TRIES = 3;

export type ShelfReport = { kind: "ok"; store: { locationId: string; name: string }; quotedAt: string } | { kind: "not_kroger" };

type Row = {
  productId: string;
  description: string;
  brand: string | null;
  size: string | null;
  regular: number;
  promo: number | null;
  inStore: boolean;
  withinBudget: boolean | null;
};

type Outcome =
  | { kind: "ok"; storeId: string; store: { locationId: string; name: string }; quotedAt: string; items: Row[] }
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "not_kroger" }
  | { kind: "pending"; retryAfterS: number }
  | { kind: "gone" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function rowOf(x: unknown): Row | null {
  const r = x as Record<string, unknown> | null;
  if (!r || typeof r.productId !== "string" || typeof r.description !== "string" || typeof r.regular !== "number") return null;
  return {
    productId: r.productId,
    description: r.description,
    brand: typeof r.brand === "string" ? r.brand : null,
    size: typeof r.size === "string" ? r.size : null,
    regular: r.regular,
    promo: typeof r.promo === "number" ? r.promo : null,
    inStore: r.inStore === true,
    withinBudget: typeof r.withinBudget === "boolean" ? r.withinBudget : null,
  };
}

async function fetchOutcome(loc: string, storeId: string, styleId: string): Promise<Outcome> {
  const query = `loc=${encodeURIComponent(loc)}&store=${encodeURIComponent(storeId)}&styleId=${encodeURIComponent(styleId)}`;
  let res: Response;
  try {
    res = await fetch(`/api/prices/drinks?${query}`, { cache: "no-store" });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status === 403) return { kind: "gone" };
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json) return { kind: "unavailable" };
  if (json.kind === "none") return { kind: "none" };
  if (json.kind === "not_kroger") return { kind: "not_kroger" };
  if (json.kind === "pending_sync") {
    const s = typeof json.retryAfterS === "number" ? json.retryAfterS : 2;
    return { kind: "pending", retryAfterS: Math.min(Math.max(s, 1), 10) };
  }
  if (json.kind === "ok") {
    const store = json.store as { locationId?: unknown; name?: unknown } | undefined;
    const items = Array.isArray(json.items) ? json.items.map(rowOf).filter((r): r is Row => r !== null).slice(0, SHOWN) : [];
    if (typeof json.storeId !== "string" || typeof store?.locationId !== "string" || typeof store.name !== "string" || items.length === 0) {
      return { kind: "unavailable" };
    }
    return {
      kind: "ok",
      storeId: json.storeId,
      store: { locationId: store.locationId, name: store.name },
      quotedAt: typeof json.quotedAt === "string" ? json.quotedAt : new Date().toISOString(),
      items,
    };
  }
  // "unavailable" and "no_store" (the preferred store is not one the server can price).
  return { kind: "unavailable" };
}

function shelfOf(outcome: Outcome): ShelfReport | null {
  if (outcome.kind === "ok") return { kind: "ok", store: outcome.store, quotedAt: outcome.quotedAt };
  if (outcome.kind === "not_kroger") return { kind: "not_kroger" };
  return null;
}

export function StoreBottles({
  styleId,
  label,
  onShelf,
}: {
  styleId: string;
  label: string;
  onShelf: (report: ShelfReport | null) => void;
}) {
  const [state, , hydrated] = useAppState();
  const selected = useSelectedBottles();
  const loc = state.places.activeId;
  const store = state.places.preferredStore;
  const storeId = store?.id;
  // The chip uses the budget in state, not the server's withinBudget: a budget edit may still await its debounced save.
  const budget = state.profile.drinksBudgetUsd;
  const hasTerm = searchTermFor(styleId) !== null;
  const req = hydrated && loc && storeId && hasTerm ? `${loc}|${storeId}|${styleId}` : null;
  const [load, setLoad] = useState<{ req: string; outcome: Outcome } | null>(null);

  const onShelfRef = useRef(onShelf);
  useEffect(() => {
    onShelfRef.current = onShelf;
  });

  useEffect(() => {
    if (!req || !loc || !storeId) return;
    const r = req;
    const epoch = currentEpoch();
    let alive = true;
    const live = () => alive && epoch === currentEpoch();
    (async () => {
      for (let tries = 1; ; tries++) {
        const outcome = await fetchOutcome(loc, storeId, styleId);
        if (!live()) return;
        if (outcome.kind === "pending" && tries < MAX_PENDING_TRIES) {
          await sleep(outcome.retryAfterS * 1000);
          if (!live()) return;
          continue;
        }
        // "pending" that never settled reads as unavailable.
        const settled: Outcome = outcome.kind === "pending" ? { kind: "unavailable" } : outcome;
        setLoad({ req: r, outcome: settled });
        onShelfRef.current(shelfOf(settled));
        return;
      }
    })();
    return () => {
      alive = false;
      onShelfRef.current(null);
    };
  }, [req, loc, storeId, styleId]);

  if (!req || !store) return null;
  const current = load?.req === req ? load.outcome : null;
  const storeName = current?.kind === "ok" ? current.store.name : store.name;

  if (current === null) {
    return (
      <p role="status" className="text-[16px] leading-snug text-muted">
        Checking {store.name}…
      </p>
    );
  }
  if (current.kind === "gone" || current.kind === "not_kroger") return null;
  if (current.kind === "none") {
    return <p className="text-[16px] leading-snug text-muted">No {label} listed at {store.name} right now.</p>;
  }
  if (current.kind !== "ok") {
    return <p className="text-[16px] leading-snug text-muted">Shelf prices aren&apos;t available right now.</p>;
  }

  const full = isBottleListFull();
  return (
    <section aria-label={`Bottles at ${storeName}`} data-store-bottles className="grid gap-2 rounded-2xl border border-line p-4">
      <h4 className="text-[16px] font-semibold leading-snug">At {storeName}</h4>
      <ul className="grid">
        {current.items.map((row) => {
          const isSelected = selected.has(row.productId);
          const livePrice = row.promo ?? row.regular;
          const withinBudget = budget !== null && livePrice <= budget;
          const price = formatStorePrice(livePrice, row.promo !== null ? row.regular : undefined);
          return (
            <li key={row.productId} className="grid gap-2 border-b border-line py-3 last:border-b-0 last:pb-0">
              <p className="break-words text-[17px] leading-snug text-ink">{row.description}</p>
              {row.brand && <p className="break-words text-[15px] leading-snug text-muted">{row.brand}</p>}
              <p className="text-[15px] leading-snug text-muted">
                {row.size ? `${row.size} · ` : ""}
                {price}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {row.inStore && <span className="text-[15px] text-muted">sold in store</span>}
                {withinBudget && (
                  <span className="rounded-full bg-saffron-soft px-3 py-1 text-[14px] font-semibold text-ink">
                    within your budget
                  </span>
                )}
                <button
                  type="button"
                  aria-pressed={isSelected}
                  disabled={!isSelected && full}
                  onClick={() => toggleSelectedBottle(row.productId, { styleId, storeId: current.storeId })}
                  className={`min-h-11 rounded-full border px-4 text-[15px] font-semibold disabled:opacity-40 ${
                    isSelected ? "border-ink bg-ink text-paper" : "border-ink/25 bg-paper text-ink"
                  }`}
                >
                  Keep in mind
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
