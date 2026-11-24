"use client";

import { useSession } from "../../lib/auth/session";
import { useEffect, useSyncExternalStore } from "react";
import type { PairingOutput } from "@/lib/pairings/schema";
import { clearBottleResult } from "./bottleResult";
import { clearSelectedBottles } from "./selectedBottles";

// Client copy of the 21+ gate. The server is the authority (cookie + row in pairing_unlocks); this module only
// decides what the page shows and drops anything held in memory the moment the gate closes.

export const PAIRINGS_CHANNEL = "cwym:pairings";

export type PairingResult = { recipeId: string; pairing: PairingOutput; createdAt: string };

type Snapshot = { unlocked: boolean; known: boolean; epoch: number; lockError: boolean };

// Module-level, shared by every component that calls the hook.
let snap: Snapshot = { unlocked: false, known: false, epoch: 0, lockError: false };
const listeners = new Set<() => void>();
const cache = new Map<string, PairingResult>();
let knownSession: string | null | undefined;
let channel: BroadcastChannel | null = null;
let globalsBound = false;
// A lock request is in flight (or has failed): the status check must not reopen the gate meanwhile.
let lockPending = false;

const LOCK_ATTEMPTS = 3;
const LOCK_RETRY_MS = 500;

function emit(next: Snapshot) {
  snap = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnap = () => snap;
const SERVER_SNAP: Snapshot = { unlocked: false, known: false, epoch: 0, lockError: false };
const getServerSnap = () => SERVER_SNAP;

// Closing the gate: empties the cache and bumps the epoch, so in-flight answers are discarded.
// La época solo avanza al bloquear: una confirmación de "sigue abierto" no debe descartar peticiones en vuelo.
function setGate(unlocked: boolean) {
  if (!unlocked) {
    cache.clear();
    // Kept bottles live only inside an unlocked session (same moments as the cache).
    clearSelectedBottles();
    // The last bottle scan lives in the same moments (lock, sign-out, session change).
    clearBottleResult();
  }
  emit({ ...snap, unlocked, known: true, epoch: unlocked ? snap.epoch : snap.epoch + 1 });
}

function setLockError(lockError: boolean) {
  emit({ ...snap, lockError });
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function ensureChannel() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(PAIRINGS_CHANNEL);
  channel.onmessage = (e: MessageEvent) => {
    if (e.data === "lock" || e.data === "signout") setGate(false);
  };
}

function ensureGlobals() {
  if (globalsBound || typeof window === "undefined") return;
  globalsBound = true;
  window.addEventListener("focus", () => void refresh());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
}

// Asks the server. An answer that arrives after the epoch moved is ignored: a lock or sign-out won.
export async function refresh(): Promise<void> {
  if (lockPending || snap.lockError || knownSession === null) return; // nobody signed in: nothing to ask
  const epoch = snap.epoch;
  let res: Response;
  try {
    res = await fetch("/api/pair/status", { cache: "no-store" });
  } catch {
    return;
  }
  if (epoch !== snap.epoch) return;
  if (!res.ok) {
    setGate(false);
    return;
  }
  const json = (await res.json().catch(() => null)) as { unlocked?: unknown } | null;
  if (epoch !== snap.epoch) return;
  setGate(json?.unlocked === true);
}

export async function unlock(): Promise<boolean> {
  // A lock in flight wins: it may delete the unlock row after this one is created.
  if (lockPending) return false;
  const epoch = snap.epoch;
  let res: Response;
  try {
    res = await fetch("/api/pair/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
  } catch {
    return false;
  }
  // A lock or sign-out that happened during the request wins: the late answer is discarded.
  if (epoch !== snap.epoch) return false;
  if (!res.ok) return false;
  emit({ ...snap, lockError: false });
  setGate(true);
  return true;
}

// Closes the gate here first (synchronously), tells the other tabs, then asks the server to revoke the cookie.
// The server call must succeed: it is retried, and if every attempt fails the gate stays closed and lockError is set.
export async function lock(message: "lock" | "signout" = "lock"): Promise<void> {
  setGate(false);
  channel?.postMessage(message);
  lockPending = true;
  setLockError(false);
  try {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      if (attempt > 0) await delay(LOCK_RETRY_MS);
      try {
        const res = await fetch("/api/pair/lock", { method: "POST" });
        if (res.ok) return;
      } catch {
        // Network error counts as a failed attempt.
      }
      // Still closed on the client: the cache is cleared and in-flight answers are discarded.
      setGate(false);
    }
    setLockError(true);
  } finally {
    lockPending = false;
  }
}

export function currentEpoch(): number {
  return snap.epoch;
}

export function getCachedPairing(recipeId: string): PairingResult | undefined {
  return cache.get(recipeId);
}

// Stores only while the gate is open and still the same epoch the request left with.
export function cachePairing(result: PairingResult, epoch: number) {
  if (snap.unlocked && epoch === snap.epoch) cache.set(result.recipeId, result);
}

export function usePairingsGate() {
  const { sessionId } = useSession();
  const state = useSyncExternalStore(subscribe, getSnap, getServerSnap);

  useEffect(() => {
    ensureChannel();
    ensureGlobals();
    // A new Clerk session (sign-in, sign-out, another account) starts locked.
    if (knownSession !== undefined && knownSession !== (sessionId ?? null)) setGate(false);
    knownSession = sessionId ?? null;
    // Sin sesión no hay nada que preguntar: queda bloqueado y no se dispara una petición.
    if (!sessionId) {
      setGate(false);
      return;
    }
    void refresh();
  }, [sessionId]);

  return {
    // Locked on the first render after a session change, before the effect above has cleared the gate.
    unlocked: state.unlocked && knownSession === (sessionId ?? null),
    known: state.known,
    epoch: state.epoch,
    lockError: state.lockError,
    unlock,
    lock,
    refresh,
  };
}
