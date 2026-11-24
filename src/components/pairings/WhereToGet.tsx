"use client";

import { useEffect, useState } from "react";
import { fetchPlacesStep, type Place } from "@/components/places/api";
import { useAppState } from "@/lib/useAppState";

const MAX_POLLS = 40;

type Load = { key: string; status: string; places: Place[] };

// What the bottle cards above found in the preferred store: "ok" = shelf prices shown above; "not_kroger" = no shelf
// price exists for it; null = nothing to say about the shelf (no preferred store, or unavailable / none).
export type ShelfState = "ok" | "not_kroger" | null;

// Nearby liquor stores from the saved place's radius (the same /api/places the Near page uses).
const WHOLE_CITY_STORE_RADIUS = 5;
// Stock and prices are not known here; the search links below are the way to check a bottle.
export function WhereToGet({ styles, shelf = null }: { styles: { name: string }[]; shelf?: ShelfState }) {
  const [state, , hydrated] = useAppState();
  const preferred = state.places.preferredStore;
  const shelfNote =
    shelf === "ok" && preferred
      ? `Shelf prices above are from ${preferred.name}.`
      : shelf === "not_kroger"
        ? "Your preferred store isn't a Kroger store, so there's no shelf price here; nearby shops below."
        : null;
  const active = state.places.saved.find((l) => l.id === state.places.activeId);
  const activeId = active?.id;
  // For the local-price search: the saved place's ZIP when it has one, else its label.
  const near = active?.zip ?? state.location?.zip ?? active?.label ?? "";
  // "Whole city" saves no radius; stores still need one, so the lookup uses a default and says so.
  const wholeCity = active !== undefined && active.radiusMiles === undefined;
  const radius = active === undefined ? undefined : (active.radiusMiles ?? WHOLE_CITY_STORE_RADIUS);
  const label = active?.label;
  const [load, setLoad] = useState<Load | null>(null);
  const key = `${activeId ?? ""}|${radius ?? ""}`;

  useEffect(() => {
    if (!activeId || radius === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async (poll: number) => {
      try {
        const step = await fetchPlacesStep(activeId, wholeCity ? radius : undefined);
        if (cancelled) return;
        if ((step.kind === "pending" || step.kind === "notready") && poll < MAX_POLLS) {
          const wait = step.kind === "pending" ? step.retryAfterS * 1000 : 1000;
          timer = setTimeout(() => void run(poll + 1), wait);
          return;
        }
        if (step.kind === "done") {
          setLoad({ key, status: step.status, places: step.places.filter((p) => p.type === "liquor") });
        } else {
          setLoad({ key, status: "unavailable", places: [] });
        }
      } catch {
        if (!cancelled) setLoad({ key, status: "unavailable", places: [] });
      }
    };
    void run(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeId, radius, key, wholeCity]);
  const current = load?.key === key ? load : null;

  return (
    <section aria-labelledby="where-title" className="grid gap-5">
      <h2 id="where-title" className="text-[28px] leading-tight">
        Where to get it
      </h2>

      <div className="grid gap-3">
        {shelfNote && <p className="text-[17px] leading-snug text-muted">{shelfNote}</p>}
        <h3 className="text-[20px] font-semibold">Nearby stores (stock unknown)</h3>
        {hydrated && wholeCity && current && current.places.length > 0 && (
          <p className="text-[15px] text-muted">Within {radius} mi of {label}. Change the radius in the location pill.</p>
        )}
        {!hydrated ? null : !activeId || radius === undefined ? (
          <p className="text-[17px] text-muted">Add your address in the location pill to see nearby stores.</p>
        ) : current === null ? (
          <p role="status" className="text-[17px] text-muted">
            Looking for stores near {label}…
          </p>
        ) : current.status === "unavailable" ? (
          <p className="text-[17px] text-muted">Store search is unavailable right now. Try again later.</p>
        ) : current.places.length === 0 ? (
          <p className="text-[17px] text-muted">
            No liquor or wine stores within {radius} mi of {label}.
          </p>
        ) : (
          <ul className="grid gap-2">
            {current.places.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 rounded-2xl border border-line px-4 py-3">
                <div className="grid gap-0.5">
                  <span className="text-[18px] font-semibold text-ink">{p.name}</span>
                  <span className="text-[15px] text-muted">{p.distanceMi.toFixed(1)} mi away</span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-[16px] font-semibold text-tomato">
                  {p.website && (
                    <a href={p.website} target="_blank" rel="noopener" className="underline underline-offset-4" data-testid="store-website">
                      Store site
                    </a>
                  )}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}
                    target="_blank"
                    rel="noopener"
                    className="underline underline-offset-4"
                  >
                    Open in Maps
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3">
        <h3 className="text-[20px] font-semibold">Prices near you</h3>
        <p className="text-[15px] leading-snug text-muted">Live shelf prices come from the stores themselves; these searches open them.</p>
        {styles.map((s) => (
          <div key={s.name} className="grid gap-2">
            <a
              href={`https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`${s.name}${near ? ` near ${near}` : ""}`)}`}
              target="_blank"
              rel="noopener"
              className="text-[18px] font-semibold text-tomato underline underline-offset-4"
              data-testid="local-prices"
            >
              Local prices for {s.name}
            </a>
            <a
              href={`https://www.totalwine.com/search/all?text=${encodeURIComponent(s.name)}`}
              target="_blank"
              rel="noopener"
              className="text-[16px] font-semibold text-muted underline underline-offset-4"
            >
              Search {s.name} on Total Wine
            </a>
          </div>
        ))}
      </div>

      <p className="text-[16px] leading-snug text-muted">
        Delivery options and age/ID rules depend on your state and the provider. Check availability for your address
        in their app.
      </p>
    </section>
  );
}
