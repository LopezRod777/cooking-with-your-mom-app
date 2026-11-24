"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Rendered when a client-router fetch (soft navigation or prefetch) arrives while Clerk is rotating the session
// token: one full reload does the handshake and the page comes back signed in. If it happens twice in a row the
// session is really gone, so offer the door instead of looping.
const FLAG = "cwym:session-retry";

export function SessionRetry() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let retried = false;
    try {
      retried = sessionStorage.getItem(FLAG) === "1";
      if (!retried) sessionStorage.setItem(FLAG, "1");
    } catch {
      // Storage blocked: reload once anyway.
    }
    if (retried) {
      setStuck(true);
      try {
        sessionStorage.removeItem(FLAG);
      } catch {
        // ignore
      }
      return;
    }
    window.location.reload();
  }, []);
  if (!stuck) return <div className="min-h-dvh" aria-busy="true" />;
  return (
    <main className="mx-auto grid min-h-dvh max-w-[420px] content-center gap-4 px-6">
      <p className="font-display text-[30px] leading-tight text-ink">Mama lost track of you for a second.</p>
      <Link href="/sign-in" className="inline-flex min-h-12 w-fit items-center rounded-full bg-tomato px-6 text-[18px] font-semibold text-paper">
        Sign in again
      </Link>
    </main>
  );
}
