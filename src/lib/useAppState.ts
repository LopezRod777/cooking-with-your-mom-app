"use client";

import { useSyncExternalStore, type SetStateAction } from "react";
import {
  decideMigration,
  getServerSnapshot,
  getSnapshot,
  resolveConflict,
  retrySync,
  setAppState,
  subscribe,
  type StoreSnapshot,
} from "./store";
import type { AppState } from "./schemas";

// [state, setState, hydrated, saveError]. One shared copy for every component.
// hydrated = signed in, and the account's state has been read from the server (or the cache, offline).
export function useAppState(): [
  AppState,
  (update: SetStateAction<AppState>) => void,
  boolean,
  string | null,
] {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [snap.state, setAppState, snap.hydrated, snap.saveError];
}

// Set when the stored data could not be read and was replaced by defaults (ISO timestamp of the backup).
export function useRecoveredFrom(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).recoveredFrom;
}

// Sync status plus the two decisions a person can make: a conflict and the one-time migration.
export function useSync(): StoreSnapshot["sync"] & {
  resolveConflict: typeof resolveConflict;
  decideMigration: typeof decideMigration;
  retry: typeof retrySync;
} {
  const sync = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).sync;
  return { ...sync, resolveConflict, decideMigration, retry: retrySync };
}

export const SYNC_LABEL: Record<StoreSnapshot["sync"]["status"], string> = {
  idle: "",
  loading: "Loading…",
  synced: "Synced",
  saving: "Saving…",
  offline: "Offline. Saved on this device.",
  conflict: "Needs your call",
  error: "Couldn't sync",
};
