"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "../../lib/auth/session";
import { useAppState } from "@/lib/useAppState";
import type { PreferredStore } from "@/lib/schemas";
import type { LivePrices } from "@/lib/prices";
import { fetchLivePrices, type PricesOutcome } from "./api";

export type LiveStatus = "idle" | "loading" | "pending" | "ok" | "no_store" | "not_configured" | "unavailable";
export type LiveResult = { status: LiveStatus; live: LivePrices | null };

const IDLE: LiveResult = { status: "idle", live: null };
// The API takes at most 60 keys per request.
const MAX_KEYS = 60;
// pending_sync means the store's quote is still syncing: retry this many times, then give up quietly ("pending").
const MAX_PENDING_RETRIES = 5;

// "error": the request failed. "mismatch": the server priced a different store than the one asked for.
type Settled = PricesOutcome | "error" | "mismatch";

// Kroger terms: no caching of content. Only identical requests that are already in flight are shared;
// nothing is kept once they settle.
const inflight = new Map<string, Promise<PricesOutcome>>();
function fetchOnce(key: string, loc: string, storeId: string, keysParam: string): Promise<PricesOutcome> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = fetchLivePrices(loc, storeId, keysParam.split(",")).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchSettled(
  key: string,
  loc: string,
  storeId: string,
  keysParam: string,
  cancelled: () => boolean,
): Promise<PricesOutcome | null> {
  for (let retries = 0; ; retries += 1) {
    if (cancelled()) return null;
    const outcome = await fetchOnce(key, loc, storeId, keysParam);
    if (outcome.status !== "pending_sync" || retries >= MAX_PENDING_RETRIES) return outcome;
    await sleep(outcome.retryAfterS * 1000);
  }
}

// Live Kroger prices for the saved location, the preferred store and the grocery keys. Fetches on mount and again
// when the identity, the keys or the preferred store change. A quote is shown and stored only when the server
// priced preferredStore.id; when it is a Kroger store, its locationId is written into state (one write). The price
// values themselves are never stored.
export function useLivePrices(
  loc: string | undefined,
  preferredStore: PreferredStore | undefined,
  keys: string[],
): LiveResult {
  const [, setState] = useAppState();
  const { userId } = useSession();
  const storeId = preferredStore?.id;
  const keysParam = keys.slice(0, MAX_KEYS).join(",");
  const active = Boolean(userId && loc && storeId && keysParam);
  const req = active ? `${userId}|${loc}|${storeId}|${keysParam}` : null;
  const [fetched, setFetched] = useState<{ req: string; outcome: Settled } | null>(null);

  // A new signed-in user never shares a request with the previous one.
  const lastUser = useRef(userId);
  useEffect(() => {
    if (lastUser.current === userId) return;
    lastUser.current = userId;
    inflight.clear();
  }, [userId]);

  useEffect(() => {
    if (!req || !userId || !loc || !storeId) return;
    const r = req;
    let cancelled = false;
    fetchSettled(`${r}`, loc, storeId, keysParam, () => cancelled)
      .then((outcome) => {
        if (cancelled || outcome === null) return;
        const store = outcome.status === "ok" || outcome.status === "no_store" ? outcome.storeId : storeId;
        // A quote for another store is discarded: no state write, no display.
        setFetched({ req: r, outcome: store === storeId ? outcome : "mismatch" });
      })
      .catch(() => {
        if (!cancelled) setFetched({ req: r, outcome: "error" });
      });
    return () => {
      cancelled = true;
      // Hidden, unmounted or switched to another user, store or keys: no quote is kept.
      setFetched(null);
    };
  }, [req, userId, loc, storeId, keysParam]);

  // Only a quote for the request in the current render counts; a previous store's quote never shows while refetching.
  const current = fetched && fetched.req === req ? fetched.outcome : null;
  const outcome = current !== null && typeof current === "object" ? current : null;
  const storeLocationId = outcome?.status === "ok" ? outcome.store.locationId : null;

  // The lookup ran and this store is not a Kroger store: remember that once (null), so no Locations call repeats.
  const notKroger = outcome?.status === "no_store" && outcome.checked;

  useEffect(() => {
    if (!storeId || !notKroger) return;
    setState((prev) => {
      const p = prev.places.preferredStore;
      if (!p || p.id !== storeId || p.krogerLocationId === null) return prev;
      return { ...prev, places: { ...prev.places, preferredStore: { ...p, krogerLocationId: null } } };
    });
  }, [storeId, notKroger, setState]);

  useEffect(() => {
    if (!storeId || storeLocationId === null) return;
    setState((prev) => {
      const p = prev.places.preferredStore;
      if (!p || p.id !== storeId || p.krogerLocationId === storeLocationId) return prev;
      return { ...prev, places: { ...prev.places, preferredStore: { ...p, krogerLocationId: storeLocationId } } };
    });
  }, [storeId, storeLocationId, setState]);

  if (req === null) return IDLE;
  if (current === null) return { status: "loading", live: null };
  if (current === "error" || current === "mismatch") return { status: "unavailable", live: null };
  if (current.status === "ok") {
    const live: LivePrices = { store: current.store, quotedAt: current.quotedAt, prices: current.prices };
    return { status: "ok", live };
  }
  if (current.status === "pending_sync") return { status: "pending", live: null };
  return { status: current.status, live: null };
}

// Text for the shop pages' aria-live region. Empty while nothing is known yet, so it announces once per quote.
export function liveAnnouncement(result: LiveResult): string {
  if (result.status === "ok" && result.live) return `Store prices loaded for ${result.live.store.name}`;
  if (result.status === "no_store" || result.status === "unavailable") return "Store prices unavailable";
  return "";
}
