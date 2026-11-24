"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { unlock } from "./usePairingsGate";

export function UnlockScreen() {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    const ok = await unlock();
    setBusy(false);
    if (!ok) setFailed(true);
  }

  return (
    <section aria-labelledby="unlock-title" className="grid gap-6">
      <Link
        href="/"
        className="inline-flex min-h-12 items-center text-[18px] font-semibold text-muted hover:text-ink lg:hidden"
      >
        ‹ Back
      </Link>
      <header className="grid gap-3">
        <h1 id="unlock-title" className="text-[40px] leading-[1.1]">
          Pairings are for adults <em className="italic text-tomato">21 and over</em>.
        </h1>
        <p className="text-[18px] leading-snug text-ink">Confirm to see them in this session.</p>
        <p className="text-[16px] leading-snug text-muted">
          This is a self-declaration, not age verification. Anyone using this signed-in browser session can see
          pairings until you lock or sign out.
        </p>
      </header>
      <div className="grid gap-2">
        <Button variant="primary" size="lg" fullWidth className="min-h-12" disabled={busy} onClick={confirm}>
          I&apos;m 21 or older
        </Button>
        {failed && (
          <p role="status" className="text-[18px] leading-snug">
            That didn&apos;t go through. Try again.
          </p>
        )}
      </div>
    </section>
  );
}
