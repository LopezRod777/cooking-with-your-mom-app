"use client";

import { useSyncExternalStore } from "react";
import type { BottleResult } from "@/lib/pairings/bottle";

// The last bottle scan, kept in memory only: nothing is persisted (no AppState, no Neon, no localStorage).
// Keyed by sessionId, so a different Clerk session never sees it. usePairingsGate clears it on lock,
// sign-out and session change, in the same place selectedBottles is cleared.

export type BottleScanData = {
  result: BottleResult;
  serve: string;
  servedIds: string[];
  fingerprint: string;
  input: { kind: "image" } | { kind: "text"; text: string };
};

type Held = { sessionId: string; data: BottleScanData } | null;

const EMPTY: Held = null;
// Replaced on every change (never mutated), so useSyncExternalStore sees a new identity only when something moved.
let current: Held = EMPTY;
const listeners = new Set<() => void>();

function set(next: Held) {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => EMPTY;

export function getBottleResult(sessionId: string): BottleScanData | null {
  return current && current.sessionId === sessionId ? current.data : null;
}

export function setBottleResult(sessionId: string, data: BottleScanData): void {
  set({ sessionId, data });
}

// Called by the gate when it closes (lock, sign-out, session change).
// Bumped on every clear (lock, sign-out, session change). A request captures it and drops a reply that lands after a clear.
let clears = 0;
export function getBottleClearCount(): number {
  return clears;
}

export function clearBottleResult(): void {
  clears += 1;
  set(EMPTY);
}

export function useBottleResult(sessionId: string): BottleScanData | null {
  const held = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return held && held.sessionId === sessionId ? held.data : null;
}
