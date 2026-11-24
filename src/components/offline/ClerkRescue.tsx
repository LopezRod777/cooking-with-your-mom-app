"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { appLoaded, reloadOnceInAWhile } from "@/lib/offline/reload";
import { getForeign, getIdentity, setOfflineIdentity } from "@/lib/store";

const WAIT_MS = 8_000;

// The page arrived but Clerk's script did not (signal coming and going): without it the app stays blank. Show this
// device's copy of the account the server just verified (never the remembered one), which sends nothing until Clerk confirms who this is, and try to reload, never in the middle of cooking.
export function ClerkRescue({ userId }: { userId: string }) {
  const { isLoaded } = useAuth();
  useEffect(() => {
    if (isLoaded) return appLoaded();
    // Again and again: the signal may be back only later, and reloads are spaced out by reloadOnceInAWhile.
    const timer = window.setInterval(() => {
      if (getForeign() !== null) return; // AccountScope is loading the page again
      if (getIdentity() === null) setOfflineIdentity(userId);
      if (navigator.onLine && !window.location.pathname.startsWith("/cook/")) reloadOnceInAWhile();
    }, WAIT_MS);
    return () => window.clearInterval(timer);
  }, [isLoaded, userId]);
  return null;
}
