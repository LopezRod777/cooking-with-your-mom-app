"use client";

import { useCallback, useSyncExternalStore, type SetStateAction } from "react";
import {
  decideMigration,
  getForeign,
  getIdentity,
  getServerSnapshot,
  getSnapshot,
  resolveConflict,
  retrySync,
  setAppStateAs,
  subscribe,
  type StoreSnapshot,
} from "./store";
import type { AppState } from "./schemas";

const noAccount = () => null;

// [state, setState, hydrated, saveError]. setState only ever writes to the account this render shows. One shared copy for every component.
// hydrated = signed in, and the account's state has been read from the server (or the cache, offline).
export function useAppState(): [
  AppState,
  (update: SetStateAction<AppState>) => void,
  boolean,
  string | null,
] {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const owner = useAccount();
  const set = useCallback((update: SetStateAction<AppState>) => setAppStateAs(owner, update), [owner]);
  return [snap.state, set, snap.hydrated, snap.saveError];
}

// The account the store holds right now (null while it loads or after signing out).
export function useAccount(): string | null {
  return useSyncExternalStore(subscribe, getIdentity, noAccount);
}

// Someone who is not who this document was made for (see AccountScope).
export function useForeign(): string | null {
  return useSyncExternalStore(subscribe, getForeign, noAccount);
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
