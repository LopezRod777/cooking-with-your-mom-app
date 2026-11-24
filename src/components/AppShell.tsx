"use client";

import Link from "next/link";
import { Fragment, useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAppState, useSync } from "@/lib/useAppState";
import type { Location, Places } from "@/lib/schemas";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { LocationPill } from "./LocationPill";
import { navItems, type NavItem } from "./nav";
import { usePairingsGate } from "./pairings/usePairingsGate";
import { NavIcon } from "./NavIcon";
import { mirrorLocation } from "./location";
import { AdminContext } from "./AdminContext";
import { UnreadDot } from "./community/UnreadDot";
import { OfflineBanner } from "./offline/OfflineBanner";

export function AppShell({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const [state, setState, hydrated] = useAppState();
  const pathname = usePathname();
  const router = useRouter();
  const onStart = pathname === "/start";
  const onboarded = state.profile.onboarded;
  const gate = usePairingsGate();
  const sync = useSync();
  // Pairings tab: "yes" in the profile shows it; "no" hides it; not asked yet shows it only while the 21+ gate is open.
  const { hasPets, cookForPets, drinkPairings } = state.profile;
  // Phones reach Community from the bubble in the header, not the bar (the owner, 2026-11-04: "solo ponlo arriba").
  const barItems = navItems({ hasPets, cookForPets, pairings: drinkPairings === true || (drinkPairings === null && gate.unlocked) }).filter((i) => i.href !== "/community");
  const railItems = navItems({ hasPets, cookForPets, pairings: drinkPairings !== false });

  // /start only once the server has answered and the account really has no setup. A failed or offline first read
  // leaves the default state in place; sending that person to /start would make them redo the setup (and an
  // admin never needs one to open the door).
  const confirmedNew = hydrated && !onboarded && (sync.status === "synced" || sync.status === "saving");
  useEffect(() => {
    if (!confirmedNew) return;
    if (pathname !== "/start" && pathname !== "/admin") {
      router.replace("/start");
    }
  }, [pathname, router, confirmedNew]);

  // `location` mirrors the active saved place, so code that still reads it keeps working.
  function savePlaces(next: Places) {
    setState((prev) => ({ ...prev, places: next, location: mirrorLocation(next.saved, next.activeId) }));
  }

  return (
    <AdminContext.Provider value={admin}>
      <Header
        location={state.location}
        places={state.places}
        onSavePlaces={savePlaces}
        showLocation={!onStart}
        showNav={!onStart}
      />
      {!onStart && (
        <Rail
          items={railItems}
          admin={admin}
          location={state.location}
          places={state.places}
          onSavePlaces={savePlaces}
        />
      )}
      <div
        className={
          onStart
            ? "flex flex-1 flex-col"
            : "flex-1 px-4 pb-28 pt-6 lg:ml-[264px] lg:px-10 lg:pb-16 lg:pt-10"
        }
      >
        <div
          data-testid="content"
          className={onStart ? "flex flex-1 flex-col" : "mx-auto w-full max-w-3xl lg:max-w-[1400px]"}
        >
          {!onStart && <OfflineBanner />}
          {children}
        </div>
      </div>
      {!onStart && <BottomNav items={barItems} />}
    </AdminContext.Provider>
  );
}

function Rail({
  items,
  admin,
  location,
  places,
  onSavePlaces,
}: {
  items: NavItem[];
  admin: boolean;
  location: Location | null;
  places: Places;
  onSavePlaces: (next: Places) => void;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      data-testid="rail"
      className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-line bg-panel px-6 py-8 lg:flex"
    >
      <Link href="/" className="font-display text-[28px] leading-[1.1] text-tomato">
        Cooking with your Mom
      </Link>
      <ul className="mt-10 grid gap-1">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Fragment key={item.href}>
              {item.href === "/settings" && (
                <li>
                  <Link
                    href="/trending"
                    aria-current={pathname === "/trending" ? "page" : undefined}
                    className={[
                      "relative flex h-[52px] items-center gap-3 pl-6 pr-3 text-[18px] font-semibold",
                      pathname === "/trending" ? "text-ink" : "text-muted hover:text-ink",
                    ].join(" ")}
                  >
                    {pathname === "/trending" && (
                      <span
                        aria-hidden="true"
                        className="absolute left-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-saffron"
                      />
                    )}
                    <NavIcon name="flame" size={22} />
                    Trending
                  </Link>
                </li>
              )}
              <li>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "relative flex h-[52px] items-center gap-3 pl-6 pr-3 text-[18px] font-semibold",
                    active ? "text-ink" : "text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute left-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-saffron"
                    />
                  )}
                  <span className="relative inline-flex">
                    <NavIcon name={item.icon} size={22} />
                    {item.href === "/community" && <UnreadDot />}
                  </span>
                  {item.label}
                </Link>
              </li>
            </Fragment>
          );
        })}
        <li>
          <Link
            href="/import"
            aria-current={pathname === "/import" ? "page" : undefined}
            className={[
              "relative flex h-[52px] items-center gap-3 pl-6 pr-3 text-[18px] font-semibold",
              pathname === "/import" ? "text-ink" : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {pathname === "/import" && (
              <span
                aria-hidden="true"
                className="absolute left-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-saffron"
              />
            )}
            <svg
              aria-hidden="true"
              width={22}
              height={22}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 8.2v7.6M8.2 12h7.6" />
            </svg>
            Add a recipe
          </Link>
        </li>
        {admin && (
          <li>
            <Link
              href="/admin"
              aria-current={pathname === "/admin" ? "page" : undefined}
              data-testid="nav-admin"
              className={[
                "relative flex h-[52px] items-center gap-3 pl-6 pr-3 text-[18px] font-semibold",
                pathname === "/admin" ? "text-ink" : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {pathname === "/admin" && (
                <span aria-hidden="true" className="absolute left-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-saffron" />
              )}
              <NavIcon name="door" size={22} />
              Waitlist
            </Link>
          </li>
        )}
      </ul>
      <div className="mt-10 grid gap-2">
        <p className="text-[14px] text-muted">Cooking in</p>
        <LocationPill location={location} places={places} onSavePlaces={onSavePlaces} />
      </div>
    </nav>
  );
}
