"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

// True inside the no-signal screens (/offline), where the browser may already be back online but nothing can be asked.
export const OfflineShellContext = createContext(false);

let inShell = false;
export function markOfflineShell(): void {
  inShell = true;
}

// For code outside React (photo queues): no point in asking the server now.
export function isOfflineNow(): boolean {
  return inShell || (typeof navigator !== "undefined" && navigator.onLine === false);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOffline(): boolean {
  const shell = useContext(OfflineShellContext);
  const off = useSyncExternalStore(subscribe, () => navigator.onLine === false, () => false);
  return shell || off;
}
