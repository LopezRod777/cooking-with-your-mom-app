"use client";

import { useEffect, useState } from "react";

// Current time, refreshed every 250 ms while enabled. Null until the first tick,
// so server and first client render never show a stale or impossible time.
export function useNow(enabled: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

// Keeps the screen on while `active`. Re-requests when the tab becomes visible
// again (the OS drops the lock on hide). Feature-detected; never throws.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const wakeLock = navigator.wakeLock;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function request() {
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      try {
        const next = await wakeLock.request("screen");
        if (cancelled) void next.release().catch(() => {});
        else sentinel = next;
      } catch {
        // Denied (battery saver, no gesture) or unsupported. The page still works.
      }
    }

    const onVisible = () => void request();
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
