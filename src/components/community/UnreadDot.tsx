"use client";

import { useSession } from "../../lib/auth/session";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SEEN_EVENT, getSeen } from "@/lib/community/seen";

const POLL_MS = 30000;

// A small tomato dot on the Community bubble when someone else wrote since this browser last opened the table.
export function UnreadDot() {
  const { isLoaded, isSignedIn } = useSession();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let gone = false;
    async function check(first = false) {
      // The first look runs even in a background tab; later polls wait until the tab is visible.
      if (!first && document.visibilityState !== "visible") return;
      try {
        const since = getSeen();
        const res = await fetch(`/api/community/unread${since ? `?since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!res.ok || gone) return;
        const j = (await res.json()) as { count: number };
        if (!gone) setCount(j.count);
      } catch {
        // offline or slow: keep what we had
      }
    }
    const t = setTimeout(() => void check(true), 0);
    const poll = setInterval(() => void check(), POLL_MS);
    const onSeen = () => setCount(0);
    window.addEventListener(SEEN_EVENT, onSeen);
    return () => {
      gone = true;
      clearTimeout(t);
      clearInterval(poll);
      window.removeEventListener(SEEN_EVENT, onSeen);
    };
  }, [isLoaded, isSignedIn, pathname]);

  if (count === 0 || pathname === "/community") return null;
  return (
    <span
      data-testid="unread-dot"
      aria-label={`${count} new at the table`}
      className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-paper bg-tomato"
    />
  );
}
