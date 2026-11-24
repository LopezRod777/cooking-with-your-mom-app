"use client";

import { useEffect } from "react";
import { savePhotos, weekMedia } from "@/lib/offline/save";
import { useAppState } from "@/lib/useAppState";

// Signed-in pages: installs the service worker, refreshes the no-signal shell once per page load, and keeps the week's
// photos on the phone. Production builds only: `next dev` files change on every save.
export function OfflineBoot() {
  const [state, , hydrated] = useAppState();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => reg.active?.postMessage({ type: "refresh-shell" }))
      .catch(() => {
        // Private window or blocked: the app works as before, only with signal.
      });
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !hydrated || !state.plan) return;
    const saver = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saver || navigator.onLine === false) return;
    const media = weekMedia(state);
    const timer = window.setTimeout(() => void savePhotos(media).catch(() => {}), 4000);
    return () => window.clearTimeout(timer);
  }, [hydrated, state]);

  return null;
}
