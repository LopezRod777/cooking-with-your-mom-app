"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppState } from "@/lib/useAppState";
import { CATALOG } from "@/lib/catalog";
import { buildCart, cartSubline, listKeys, quantity, rowPrice } from "@/lib/cart";
import { PRICES, formatAvg, formatPrice, formatStorePrice, krogerSourceLine, type LivePrices } from "@/lib/prices";
import { liveAnnouncement, useLivePrices } from "@/components/places/useLivePrices";
import { PANTRY_BASICS, buildGroceryList, splitBasics, type GroceryList } from "@/lib/grocery";
import type { WeekPlan } from "@/lib/schemas";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";

function pickStaples(plan: WeekPlan, present: Set<string>): string[] {
  const uses = new Map<string, number>();
  for (const day of plan.days) {
    for (const meal of day.meals) {
      const recipe = plan.recipes[meal.recipeId];
      if (!recipe) continue;
      for (const ing of recipe.ingredients) uses.set(ing.key, (uses.get(ing.key) ?? 0) + 1);
    }
  }
  return PANTRY_BASICS.filter((k) => present.has(k) && CATALOG[k])
    .sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0))
    .slice(0, 10);
}

function listAsText(list: GroceryList, live: LivePrices | null): string {
  return list.aisles
    .map(({ aisle, items }) =>
      [
        aisle,
        ...items.map((i) => {
          const cost = rowPrice(i, live);
          return `- ${i.displayName}: ${quantity(i)}${
            cost.usd !== null ? ` · ${formatPrice(cost.usd, cost.basis, live?.store.name, cost.regular)}` : ""
          }`;
        }),
      ].join("\n"),
    )
    .join("\n\n");
}

export function ShopList() {
  const [state, setState, hydrated] = useAppState();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const liveResult = useLivePrices(
    state.places.activeId,
    state.places.preferredStore,
    listKeys(state.plan, state.haveAtHome, state.profile.mealDrinks),
  );
  const { status: liveStatus, live } = liveResult;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!hydrated) return null;

  if (!state.plan) {
    return (
      <Card className="grid gap-5">
        <p className="text-[22px] font-semibold">Plan your week first.</p>
        <Button fullWidth onClick={() => router.push("/")}>
          Go to my week
        </Button>
      </Card>
    );
  }

  const plan = state.plan;
  const full = buildGroceryList(plan, { haveAtHome: [], prices: PRICES, mealDrinks: state.profile.mealDrinks });
  const list = buildGroceryList(plan, { haveAtHome: state.haveAtHome, prices: PRICES, mealDrinks: state.profile.mealDrinks });
  const presentKeys = new Set(full.aisles.flatMap((a) => a.items.map((i) => i.key)));
  const staples = pickStaples(plan, presentKeys);
  for (const key of state.haveAtHome) {
    if (presentKeys.has(key) && !staples.includes(key)) staples.push(key);
  }

  const cart = buildCart(list, state.checked, live);
  const subline = cartSubline(cart, live);
  const storeListed = live
    ? list.aisles.flatMap((a) => a.items).filter((i) => live.prices[i.key] !== undefined).length
    : 0;
  // Store prices exist only when the quote priced at least one item on this list.
  const hasStorePrices = Boolean(live) && storeListed > 0;
  const allKeys = list.aisles.flatMap((a) => a.items.map((i) => i.key));
  const headerSubline = hasStorePrices ? cartSubline(buildCart(list, allKeys, live), live) : "";
  const checked = new Set(state.checked);
  const checkedCount = list.aisles
    .flatMap((a) => a.items)
    .filter((i) => checked.has(i.key)).length;
  const total = list.totals.itemCount;
  const counts = splitBasics(list);
  const percent = total === 0 ? 0 : Math.round((checkedCount / total) * 100);

  function toggleHave(key: string) {
    setState((prev) => {
      const atHome = prev.haveAtHome.includes(key);
      return {
        ...prev,
        haveAtHome: atHome ? prev.haveAtHome.filter((k) => k !== key) : [...prev.haveAtHome, key],
        // Marking it at home removes it from the list, so it must not stay checked for later.
        checked: atHome ? prev.checked : prev.checked.filter((k) => k !== key),
      };
    });
  }

  function toggleChecked(key: string) {
    setState((prev) => ({
      ...prev,
      checked: prev.checked.includes(key)
        ? prev.checked.filter((k) => k !== key)
        : [...prev.checked, key],
    }));
  }

  function copyList() {
    navigator.clipboard
      ?.writeText(listAsText(list, live))
      .then(() => setCopied(true))
      .catch(() => {});
  }

  return (
    <div className="grid gap-6 pb-48 lg:pb-16">
      <header className="grid gap-2 lg:order-[-2]">
        <h1 className="text-[40px] leading-tight">Shopping list</h1>
        <p className="text-[18px] text-muted">
          {counts.toBuy} things to buy{counts.basics > 0 ? `, ${counts.basics} pantry basics` : ""} · {list.aisles.length} aisles
          {headerSubline
            ? ` · ${headerSubline}`
            : list.totals.estCostUsd !== null && ` · ≈ ${formatAvg(list.totals.estCostUsd)}`}
        </p>
        <p className="text-[15px] text-muted">
          {hasStorePrices
            ? "(avg) = government average, (est.) = our guess."
            : "US estimates, not shelf prices: Kroger-family stores show live prices, elsewhere Mama uses US averages. (avg) = government average, (est.) = our guess."}
        </p>
        {live && hasStorePrices && <p className="text-[15px] text-muted">{krogerSourceLine(live)}</p>}
        {liveStatus === "no_store" && state.places.preferredStore && (
          <p className="text-[15px] text-muted">
            No live prices for {state.places.preferredStore.name} yet (not a Kroger store).
          </p>
        )}
        <p className="sr-only" aria-live="polite">{liveAnnouncement(liveResult)}</p>
      </header>

      {staples.length > 0 && (
        <Card tone="panel" className="grid gap-4">
          <div className="grid gap-1">
            <h2 className="text-[22px] font-semibold">Already at home?</h2>
            <p className="text-[17px] text-muted">Tap what you have. It leaves the list.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {staples.map((key) => (
              <Chip key={key} selected={state.haveAtHome.includes(key)} onClick={() => toggleHave(key)}>
                {CATALOG[key]?.displayName ?? key}
              </Chip>
            ))}
          </div>
        </Card>
      )}

      {list.aisles.length === 0 && (
        <Card>
          <p className="text-[20px]">Nothing left to buy.</p>
        </Card>
      )}

      <div className="grid gap-4 rounded-[28px] bg-panel p-3 sm:grid-cols-2 lg:items-start lg:grid-cols-2 min-[1440px]:grid-cols-3">
        {list.aisles.map(({ aisle, items }) => {
          const sorted = [...items].sort(
            (a, b) => Number(checked.has(a.key)) - Number(checked.has(b.key)),
          );
          return (
            <section key={aisle} className="grid content-start gap-1 rounded-[20px] bg-paper p-5">
              <h2 className="mb-2 text-[15px] font-bold uppercase tracking-[0.12em] text-basil-text">
                {aisle}
              </h2>
              <ul>
                {sorted.map((item) => {
                  const isChecked = checked.has(item.key);
                  const cost = rowPrice(item, live);
                  return (
                    <li key={item.key} className="border-b border-line last:border-b-0">
                      <label
                        data-testid="grocery-item"
                        className="flex min-h-14 cursor-pointer items-center gap-4 py-2"
                      >
                        <input
                          type="checkbox"
                          className="h-7 w-7 flex-none accent-[var(--color-basil)]"
                          checked={isChecked}
                          onChange={() => toggleChecked(item.key)}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={[
                              "block text-[19px] leading-snug",
                              isChecked ? "text-muted line-through" : "",
                            ].join(" ")}
                          >
                            {item.displayName}
                          </span>
                          <span className="block text-[15px] text-muted">
                            about {item.gramsNeeded} g
                          </span>
                        </span>
                        <span className="min-w-0 max-w-[55%] flex-none text-right text-[16px] font-semibold">
                          {quantity(item)}
                          {cost.usd !== null && (
                            <span className="ml-2 text-[14px] font-normal text-muted">
                              {cost.basis === "store"
                                ? formatStorePrice(cost.usd, cost.regular)
                                : formatPrice(cost.usd, cost.basis)}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-line bg-paper/95 px-4 pb-3 pt-3 backdrop-blur lg:sticky lg:top-4 lg:inset-x-auto lg:bottom-auto lg:order-[-1] lg:z-20 lg:rounded-[20px] lg:border lg:px-5 lg:py-4 lg:shadow-[0_18px_40px_-22px_rgba(35,26,20,0.35)]">
        <div className="mx-auto grid max-w-3xl gap-3 lg:max-w-none lg:grid-cols-[1fr_auto] lg:items-center lg:gap-6">
          <div className="grid min-w-0 gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[18px] font-semibold">
                {checkedCount}/{total} in your cart
              </p>
              {checkedCount > 0 && (
                <Link
                  href="/shop/cart"
                  className="inline-flex min-h-12 items-center text-[18px] font-semibold text-basil-text underline underline-offset-4"
                >
                  Review cart →
                </Link>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="h-full rounded-full bg-basil transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
            {checkedCount > 0 && subline && <p className="truncate text-[15px] text-muted">{subline}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:w-[360px]">
            <Button variant="ghost" size="md" fullWidth onClick={() => setState((prev) => ({ ...prev, checked: [] }))}>
              Clear checks
            </Button>
            <Button variant="secondary" size="md" fullWidth onClick={copyList}>
              {copied ? "Copied" : "Copy list"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
