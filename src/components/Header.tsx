"use client";

import Link from "next/link";
import type { Location, Places } from "@/lib/schemas";
import { LocationPill } from "./LocationPill";
import { NavIcon } from "./NavIcon";
import { UnreadDot } from "./community/UnreadDot";
import { useAdmin } from "./AdminContext";

export function Header({
  location,
  places,
  onSavePlaces,
  showLocation,
  showNav,
}: {
  location: Location | null;
  places: Places;
  onSavePlaces: (next: Places) => void;
  showLocation: boolean;
  showNav: boolean;
}) {
  // Admins get a door icon next to the location on phones (the rail is desktop-only).
  const admin = useAdmin();
  return (
    <header
      className={[
        "sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur",
        showNav ? "lg:hidden" : "",
      ].join(" ")}
    >
      <div className="mx-auto flex min-h-[68px] max-w-5xl items-center gap-4 px-4">
        <Link
          href="/"
          className="min-w-0 font-display text-[17px] leading-tight text-tomato sm:text-[24px]"
        >
          Cooking with your Mom
        </Link>
        {showLocation && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link
                href="/community"
                aria-label="Community: the table"
                title="Community"
                data-testid="header-community"
                className="relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-ink/20 bg-white text-ink"
              >
                <NavIcon name="bubble" size={20} />
                <UnreadDot />
              </Link>
            {admin && (
              <Link
                href="/admin"
                aria-label="Waitlist: who’s at the door"
                title="Waitlist"
                data-testid="header-admin"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-ink/20 bg-white text-ink"
              >
                <NavIcon name="door" size={20} />
              </Link>
            )}
            <LocationPill location={location} places={places} onSavePlaces={onSavePlaces} compact={admin} />
          </div>
        )}
      </div>
    </header>
  );
}
