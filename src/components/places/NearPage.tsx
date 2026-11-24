"use client";

import { useEffect, useState } from "react";
import { useAppState } from "@/lib/useAppState";
import { milesText } from "../location";
import { fetchPlacesStep, type Place, type PlaceType, type Truncated } from "./api";
import { listKeys } from "@/lib/cart";
import { useLivePrices } from "./useLivePrices";

const NOT_READY_LIMIT_MS = 15_000;
const POLL_LIMIT_MS = 150_000;
const SECTIONS: { type: PlaceType; title: string }[] = [
  { type: "grocery", title: "Grocery" },
  { type: "convenience", title: "Convenience" },
  { type: "liquor", title: "Liquor & wine" },
  { type: "vet", title: "Vets" },
];

type Load =
  | { key: string; phase: "pending" }
  | { key: string; phase: "done"; status: "ok" | "empty" | "unavailable"; places: Place[]; truncated: Truncated };

const NO_TRUNCATION: Truncated = { grocery: false, convenience: false, liquor: false, vet: false };

// Polls /api/places while the server answers 202 (first search can take up to two minutes).
function useNearbyPlaces(id: string | undefined, radius: number | undefined): Load | null {
  const key = id && radius !== undefined ? `${id}|${radius}` : null;
  const [load, setLoad] = useState<Load | null>(null);

  useEffect(() => {
    if (!id || key === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    async function poll() {
      try {
        const step = await fetchPlacesStep(id!);
        if (cancelled) return;
        if (step.kind === "notready") {
          if (Date.now() - started >= NOT_READY_LIMIT_MS) {
            setLoad({ key: key!, phase: "done", status: "unavailable", places: [], truncated: NO_TRUNCATION });
            return;
          }
          setLoad({ key: key!, phase: "pending" });
          timer = setTimeout(poll, 3000);
          return;
        }
        if (step.kind === "done") {
          setLoad({ key: key!, phase: "done", status: step.status, places: step.places, truncated: step.truncated });
          return;
        }
        if (Date.now() - started >= POLL_LIMIT_MS) {
          setLoad({ key: key!, phase: "done", status: "unavailable", places: [], truncated: NO_TRUNCATION });
          return;
        }
        setLoad({ key: key!, phase: "pending" });
        timer = setTimeout(poll, step.retryAfterS * 1000);
      } catch {
        if (!cancelled) setLoad({ key: key!, phase: "done", status: "unavailable", places: [], truncated: NO_TRUNCATION });
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, key]);

  if (key === null) return null;
  return load?.key === key ? load : { key, phase: "pending" };
}

export function NearPage() {
  const [state, setState, hydrated] = useAppState();
  const places = state.places;
  const active = places.saved.find((s) => s.id === places.activeId) ?? null;
  const radius = active?.radiusMiles;
  const load = useNearbyPlaces(active?.id, radius);
  // Fetching live prices here also persists the store's Kroger locationId (see useLivePrices).
  useLivePrices(places.activeId, places.preferredStore, listKeys(state.plan, state.haveAtHome, state.profile.mealDrinks));

  function prefer(p: Place) {
    setState((prev) => ({
      ...prev,
      places: {
        ...prev.places,
        preferredStore: {
          id: p.id.slice(0, 80),
          name: p.name.slice(0, 80),
          ...(p.brand ? { brand: p.brand.slice(0, 40) } : {}),
          lat: p.lat,
          lng: p.lng,
          // Same store picked again: keep what was learned (a Kroger id, or null = checked, not Kroger).
          ...(prev.places.preferredStore?.id === p.id.slice(0, 80) && prev.places.preferredStore.krogerLocationId !== undefined
            ? { krogerLocationId: prev.places.preferredStore.krogerLocationId }
            : {}),
        },
      },
    }));
  }

  const preferredId = places.preferredStore?.id;

  return (
    <div className="grid gap-8 pb-32 lg:pb-8">
      <header className="grid gap-2">
        <h1 className="font-display text-[40px] leading-tight">Near you</h1>
        {active && (
          <p className="text-[18px] text-muted">
            {active.label}
            {radius !== undefined ? ` · within ${milesText(radius)}` : ""}
          </p>
        )}
      </header>

      {!hydrated && <p className="text-[18px] text-muted">Loading your places…</p>}

      {hydrated && !active && (
        <p className="rounded-2xl bg-saffron-soft px-5 py-4 text-[18px] text-ink">
          Set where you are cooking first. Use the location pill to set one.
        </p>
      )}

      {hydrated && active && radius === undefined && (
        <p className="rounded-2xl bg-saffron-soft px-5 py-4 text-[18px] text-ink">
          Pick a radius in the location pill to search nearby.
        </p>
      )}

      {hydrated && active && radius !== undefined && load?.phase === "pending" && (
        <p role="status" className="text-[18px] text-muted">
          Searching OpenStreetMap… the first search can take up to two minutes.
        </p>
      )}

      {hydrated && active && radius !== undefined && load?.phase === "done" && load.status === "unavailable" && (
        <p role="status" className="rounded-2xl bg-saffron-soft px-5 py-4 text-[18px] text-ink">
          Map service is busy. Try again in a minute.
        </p>
      )}

      {hydrated && active && radius !== undefined && load?.phase === "done" && load.status === "empty" && (
        <p role="status" className="rounded-2xl bg-saffron-soft px-5 py-4 text-[18px] text-ink">
          No stores within {milesText(radius)} of {active.label}.
        </p>
      )}

      {hydrated && active && radius !== undefined && load?.phase === "done" && load.status === "ok" && (
        <div className="grid gap-10">
          {SECTIONS.map((section) => {
            const items = load.places
              .filter((p) => p.type === section.type)
              .sort((a, b) => a.distanceMi - b.distanceMi);
            const headingId = `near-${section.type}`;
            return (
              <section key={section.type} aria-labelledby={headingId} className="grid gap-2">
                <h2 id={headingId} className="text-[28px] leading-tight">
                  {section.title}
                </h2>
                {load.truncated[section.type] && (
                  <p className="text-[15px] text-muted">Showing the 25 closest.</p>
                )}
                {items.length === 0 ? (
                  <p className="py-3 text-[17px] text-muted">None within {milesText(radius)}.</p>
                ) : (
                  <ul className="divide-y divide-line border-t border-line">
                    {items.map((p) => (
                      <PlaceRow
                        key={p.id}
                        place={p}
                        isVet={section.type === "vet"}
                        isGrocery={section.type === "grocery"}
                        preferred={preferredId === p.id}
                        onPrefer={() => prefer(p)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <footer className="border-t border-line pt-6 text-[15px] leading-relaxed text-muted">
        Places from OpenStreetMap (Overpass), which receives your location rounded to about 100 m and your radius.{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener"
          className="underline underline-offset-4"
        >
          © OpenStreetMap contributors
        </a>
      </footer>
    </div>
  );
}

function PlaceRow({
  place,
  isVet,
  isGrocery,
  preferred,
  onPrefer,
}: {
  place: Place;
  isVet: boolean;
  isGrocery: boolean;
  preferred: boolean;
  onPrefer: () => void;
}) {
  const showBrand = !!place.brand && place.brand.toLowerCase() !== place.name.toLowerCase();
  return (
    <li className="grid gap-2 py-4">
      <div className="min-w-0">
        <p className="break-words text-[19px] font-semibold leading-snug text-ink">
          {place.name}
          {showBrand && <span className="font-normal text-muted"> · {place.brand}</span>}
        </p>
        <p className="break-words text-[16px] text-muted">
          {place.distanceMi.toFixed(1)} mi{place.address ? ` · ${place.address}` : ""}
        </p>
        {place.openingHours && <p className="break-words text-[16px] text-muted">{place.openingHours}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {isVet && place.phone && (
          <a href={`tel:${place.phone}`} className="inline-flex min-h-12 items-center text-[18px] font-semibold text-tomato underline underline-offset-4">
            Call {place.phone}
          </a>
        )}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-12 items-center text-[18px] font-semibold text-ink underline underline-offset-4"
        >
          Open in Maps
        </a>
        {isGrocery && (
          <button
            type="button"
            onClick={onPrefer}
            aria-pressed={preferred}
            className={[
              "inline-flex min-h-12 items-center rounded-full px-5 text-[18px] font-semibold",
              preferred ? "bg-basil-soft text-basil-text" : "border border-ink/25 bg-paper text-ink",
            ].join(" ")}
          >
            {preferred ? "Preferred" : "Prefer this store"}
          </button>
        )}
      </div>
    </li>
  );
}
