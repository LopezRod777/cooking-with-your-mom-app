"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAppState } from "@/lib/useAppState";
import { buildCart, cartSubline, cartText, listKeys, quantity, rowPrice, type CartItem } from "@/lib/cart";
import { PRICES, formatPrice, formatStorePrice, krogerSourceLine } from "@/lib/prices";
import { buildGroceryList } from "@/lib/grocery";
import { liveAnnouncement, useLivePrices } from "@/components/places/useLivePrices";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { usePairingsGate } from "@/components/pairings/usePairingsGate";
import { useSelectedBottles } from "@/components/pairings/selectedBottles";
import { DrinksSection } from "./DrinksSection";

const backClass =
  "inline-flex min-h-12 w-full items-center justify-center rounded-full border border-ink/25 bg-paper px-6 text-[18px] font-semibold text-ink sm:w-auto";

export function CartPage() {
  const [state, setState, hydrated] = useAppState();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Read once per render from the browser; false on the server so hydration matches.
  const canShare = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.share === "function",
    () => false,
  );
  const liveResult = useLivePrices(state.places.activeId, state.places.preferredStore, listKeys(state.plan, state.haveAtHome, state.profile.mealDrinks));
  const { live } = liveResult;
  // Drinks kept in mind are shown only while the 21+ gate is open; a lock hides them on the same render.
  const gate = usePairingsGate();
  const keptBottles = useSelectedBottles();
  const showDrinks = gate.unlocked && keptBottles.size > 0;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!hydrated) return null;

  if (!state.plan) {
    // Bottles kept in mind still show here: with no week there are no groceries, so the total is 0.
    return (
      <div className="grid gap-6 pb-16">
        <Card className="grid gap-5">
          <p className="text-[22px] font-semibold">Plan your week first.</p>
          <Link href="/" className="inline-flex min-h-12 items-center justify-center rounded-full bg-tomato px-6 text-[18px] font-semibold text-tomato-ink">
            Go to my week
          </Link>
        </Card>
        {showDrinks && <DrinksSection groceriesUsd={0} />}
      </div>
    );
  }

  const list = buildGroceryList(state.plan, { haveAtHome: state.haveAtHome, prices: PRICES, mealDrinks: state.profile.mealDrinks });
  const cart = buildCart(list, state.checked, live);
  const subline = [`${cart.itemCount} items`, cartSubline(cart, live)].filter((p) => p !== "").join(" · ");
  // With a live quote, rows the store priced sit in their own group; the rest are not claimed for any store.
  const storeItems = live ? cart.aisles.flatMap((a) => a.items).filter((i) => i.storePrice !== undefined) : [];
  const otherAisles = live
    ? cart.aisles
        .map(({ aisle, items }) => ({ aisle, items: items.filter((i) => i.storePrice === undefined) }))
        .filter((a) => a.items.length > 0)
    : cart.aisles;
  const hasStorePrices = Boolean(live) && storeItems.length > 0;

  // Copy and Share send the same text.
  const textOpts = { live, storeName: state.places.preferredStore?.name };

  function copyCart() {
    navigator.clipboard
      ?.writeText(cartText(cart, textOpts))
      .then(() => setCopied(true))
      .catch(() => {});
  }

  function shareCart() {
    navigator.share?.({ title: "Cart", text: cartText(cart, textOpts) }).catch(() => {});
  }

  function clearCart() {
    setState((prev) => ({ ...prev, checked: [] }));
    setConfirming(false);
  }

  // Groceries total for the drinks totals line: 0 for an empty grocery cart, null when nothing in it has a price.
  const groceriesUsd = cart.itemCount === 0 ? 0 : cart.totals.estUsd;

  if (cart.itemCount === 0) {
    return (
      <div className="grid gap-6 pb-16">
        <header className="grid gap-2">
          <h1 className="text-[40px] leading-tight">Your cart</h1>
        </header>
        <Card className="grid gap-5">
          <p className="text-[20px]">Nothing in the cart yet. Tick items in the shopping list.</p>
          <Link href="/shop" className={backClass}>
            Back to list
          </Link>
        </Card>
        {showDrinks && <DrinksSection groceriesUsd={groceriesUsd} />}
      </div>
    );
  }

  function renderRow(item: CartItem) {
    const cost = rowPrice(item, live);
    return (
      <li key={item.key} className="border-b border-line last:border-b-0">
        <div data-testid="cart-item" className="flex min-h-14 items-center gap-4 py-2">
          <span className="min-w-0 flex-1 text-[19px] leading-snug">{item.displayName}</span>
          <span className="min-w-0 max-w-[60%] text-right text-[16px] font-semibold">
            {quantity(item)}
            <span className="ml-2 text-[14px] font-normal text-muted">
              {cost.usd === null
                ? "no price"
                : cost.basis === "store"
                  ? formatStorePrice(cost.usd, cost.regular)
                  : formatPrice(cost.usd, cost.basis)}
            </span>
          </span>
        </div>
      </li>
    );
  }

  return (
    <div className="grid gap-6 pb-16">
      <header className="grid gap-2">
        <h1 className="text-[40px] leading-tight">Your cart</h1>
        <p className="text-[18px] text-muted">{subline}</p>
        <p className="text-[15px] text-muted">
          {hasStorePrices
            ? "(avg) = government average, (est.) = our guess."
            : "US estimates, not shelf prices: Kroger-family stores show live prices, elsewhere Mama uses US averages. (avg) = government average, (est.) = our guess."}
        </p>
        {live && hasStorePrices && <p className="text-[15px] text-muted">{krogerSourceLine(live)}</p>}
        <p className="sr-only" aria-live="polite">{liveAnnouncement(liveResult)}</p>
      </header>

      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
        <Button variant="secondary" size="md" fullWidth={false} className="min-h-12 w-full sm:w-auto" onClick={copyCart}>
          {copied ? "Copied" : "Copy list"}
        </Button>
        {canShare && (
          <Button variant="secondary" size="md" fullWidth={false} className="min-h-12 w-full sm:w-auto" onClick={shareCart}>
            Share
          </Button>
        )}
        <Link href="/shop" className={backClass}>
          Back to list
        </Link>
        {confirming ? (
          <div className="flex items-center gap-3">
            <span className="text-[17px]">Clear the cart?</span>
            <Button variant="primary" size="md" className="min-h-12" onClick={clearCart}>
              Yes
            </Button>
            <Button variant="ghost" size="md" className="min-h-12" onClick={() => setConfirming(false)}>
              No
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="md" fullWidth={false} className="min-h-12 w-full sm:w-auto" onClick={() => setConfirming(true)}>
            Clear cart
          </Button>
        )}
      </div>

      <div className="grid gap-4 rounded-[28px] bg-panel p-3 sm:grid-cols-2 min-[1440px]:grid-cols-3">
        {live && storeItems.length > 0 && (
          <section className="grid content-start gap-1 rounded-[20px] bg-paper p-5">
            <h2 className="mb-2 text-[15px] font-bold uppercase tracking-[0.12em] text-basil-text">
              At {live.store.name}
            </h2>
            <ul>{storeItems.map((item) => renderRow(item))}</ul>
          </section>
        )}
        {live && otherAisles.length > 0 && (
          <div className="col-span-full grid gap-1 px-2 pt-2">
            <h2 className="text-[18px] font-semibold">Nearby stores (stock unknown)</h2>
            <Link href="/near" className="inline-flex min-h-12 items-center text-[17px] font-semibold text-basil-text underline underline-offset-4">
              See stores near you
            </Link>
          </div>
        )}
        {otherAisles.map(({ aisle, items }) => (
          <section key={aisle} className="grid content-start gap-1 rounded-[20px] bg-paper p-5">
            <h2 className="mb-2 text-[15px] font-bold uppercase tracking-[0.12em] text-basil-text">{aisle}</h2>
            <ul>{items.map((item) => renderRow(item))}</ul>
          </section>
        ))}
      </div>
      {showDrinks && <DrinksSection groceriesUsd={groceriesUsd} />}
    </div>
  );
}
