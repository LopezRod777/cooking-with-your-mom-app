"use client";

import { useSyncExternalStore } from "react";

// Bottles the user kept in mind from a pairing card. Memory only: nothing is persisted (no AppState, no Neon,
// no localStorage). Only identifiers are kept; the cart re-quotes prices and names live. usePairingsGate clears it
// on lock, sign-out and session change.

export const MAX_SELECTED_BOTTLES = 12;

export type SelectedBottle = { styleId: string; storeId: string };
export type SelectedBottles = ReadonlyMap<string, SelectedBottle>;

const EMPTY: SelectedBottles = new Map();
// Replaced on every change (never mutated), so useSyncExternalStore sees a new identity only when something moved.
let current: SelectedBottles = EMPTY;
const listeners = new Set<() => void>();

function set(next: SelectedBottles) {
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

export function useSelectedBottles(): SelectedBottles {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// The current selection, read without subscribing (tests and non-rendering callers).
export function getSelectedBottles(): SelectedBottles {
  return current;
}

export function isBottleSelected(productId: string): boolean {
  return current.has(productId);
}

export function isBottleListFull(): boolean {
  return current.size >= MAX_SELECTED_BOTTLES;
}

// Adds a bottle. False when the list is full (and the bottle is not already in it).
export function addSelectedBottle(productId: string, bottle: SelectedBottle): boolean {
  if (!current.has(productId) && current.size >= MAX_SELECTED_BOTTLES) return false;
  const next = new Map(current);
  next.set(productId, bottle);
  set(next);
  return true;
}

export function removeSelectedBottle(productId: string): void {
  if (!current.has(productId)) return;
  const next = new Map(current);
  next.delete(productId);
  set(next);
}

// Toggles one bottle. Returns true when it is selected afterwards (false also when the list is full).
export function toggleSelectedBottle(productId: string, bottle: SelectedBottle): boolean {
  if (current.has(productId)) {
    removeSelectedBottle(productId);
    return false;
  }
  return addSelectedBottle(productId, bottle);
}

// Called by the gate when it closes (lock, sign-out, session change).
export function clearSelectedBottles(): void {
  set(EMPTY);
}
