"use client";

import Link from "next/link";
import { Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { CookMode } from "@/components/cook/CookMode";
import { FavoritesGrid } from "@/components/favorites/FavoritesGrid";
import { RecipeView } from "@/components/recipe/RecipeView";
import { CartPage } from "@/components/shop/CartPage";
import { ShopList } from "@/components/shop/ShopList";
import { WeekPage } from "@/components/week/WeekPage";
import { ConflictBar } from "@/components/sync/SyncBoot";
import { btnPrimary } from "@/components/week/classes";
import { OfflineShellContext, markOfflineShell } from "@/lib/offline/useOffline";
import { reloadOnceInAWhile } from "@/lib/offline/reload";
import { readLastUser, setOfflineIdentity } from "@/lib/store";
import { useAppState, useSync } from "@/lib/useAppState";

const neverChanges = () => () => {};

// The one page the service worker answers with when a page cannot be fetched. It carries no account data: everything
// comes from this device's copy, and nothing is sent. Rendered only after mount, since the address is whatever was asked.
export function OfflineShell() {
  const path = useSyncExternalStore(neverChanges, () => window.location.pathname, () => null);
  const [, , known] = useAppState();
  const sync = useSync();

  // Before the first paint: the copy on this device, or the "sign in once" screen.
  useLayoutEffect(() => {
    markOfflineShell();
    const id = readLastUser();
    if (id) setOfflineIdentity(id);
  }, []);

  if (path === null) return <div className="min-h-dvh" aria-busy="true" />;
  const cooking = path.startsWith("/cook/");
  return (
    <OfflineShellContext.Provider value={true}>
      <BackOnline cooking={cooking} />
      {sync.conflict && <ConflictBar local={sync.conflict.local === true} onResolve={sync.resolveConflict} />}
      {known ? (
        <AppShell>
          <Suspense fallback={null}>{screenFor(path)}</Suspense>
        </AppShell>
      ) : (
        <main className="mx-auto grid min-h-dvh max-w-[420px] content-center gap-4 px-6">
          <p className="font-display text-[30px] leading-tight">No signal, honey.</p>
          <p className="text-[18px] text-muted">Sign in once with signal on this device and your week stays here.</p>
        </main>
      )}
    </OfflineShellContext.Provider>
  );
}

function screenFor(path: string): ReactNode {
  const [, section, id] = path.split("/");
  if (path === "/" || path === "/offline") return <WeekPage />;
  if (section === "recipe" && id && id !== "shared") return <RecipeView id={decodeURIComponent(id)} />;
  if (section === "cook" && id) return <CookMode id={decodeURIComponent(id)} />;
  if (path === "/shop") return <ShopList />;
  if (path === "/shop/cart") return <CartPage />;
  if (path === "/favorites") return <FavoritesGrid />;
  return (
    <section data-testid="needs-signal" className="grid gap-5 py-12 text-center">
      <h1 className="font-display text-[34px] leading-tight">Mama needs signal for this one, honey.</h1>
      <Link href="/" className={`${btnPrimary} mx-auto`}>
        Back to this week
      </Link>
    </section>
  );
}

// Back to the real app once it answers. By itself at most every 30 s, and never in the middle of cooking.
function BackOnline({ cooking }: { cooking: boolean }) {
  const [reachable, setReachable] = useState(false);

  useEffect(() => {
    let gone = false;
    async function check() {
      // Its own type, not just a 200: a hotel or café sign-in page answers 200 to anything.
      const ok = await fetch("/manifest.webmanifest", { cache: "no-store", credentials: "omit" }).then(
        (r) => r.ok && !r.redirected && /json/.test(r.headers.get("content-type") ?? ""),
        () => false,
      );
      if (gone || !ok) return;
      setReachable(true);
      if (cooking || window.location.pathname === "/offline") return;
      reloadOnceInAWhile();
    }
    const onOnline = () => void check();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(onOnline, 15_000);
    return () => {
      gone = true;
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [cooking]);

  if (!reachable) return null;
  return (
    <div role="status" data-testid="back-online" className="fixed inset-x-3 top-3 z-[70] flex items-center justify-between gap-4 rounded-[20px] border border-line bg-paper px-5 py-3 text-ink shadow-xl sm:left-auto sm:w-[420px]">
      <p className="text-[17px] leading-snug">You&apos;re back online.</p>
      <button type="button" onClick={() => (window.location.pathname === "/offline" ? window.location.assign("/") : window.location.reload())} className="min-h-12 rounded-full border-2 border-line px-4 text-[16px] font-semibold">
        Reload
      </button>
    </div>
  );
}
