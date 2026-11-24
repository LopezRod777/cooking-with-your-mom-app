"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { DISTANCE_STEPS, type Location, type Places, type SavedLocation } from "@/lib/schemas";
import { getIdentity, getSnapshot } from "@/lib/store";
import { useAppState } from "@/lib/useAppState";
import { Button } from "./ui/Button";
import { Field, inputClass } from "./ui/Field";
import {
  LOCATION_ERROR,
  MAX_SAVED_LOCATIONS,
  milesText,
  newLocationId,
  nextActive,
  parseLocation,
} from "./location";
import { geocodeLocation, prefetchPlaces } from "./places/api";

const DEFAULT_RADIUS_INDEX = DISTANCE_STEPS.indexOf(3);
const PREFETCH_DELAY_MS = 2500; // the state PUT is debounced 1.5 s; the server must have the place before it is asked for
const BUSY_COPY = "Map service is busy, try again in a minute.";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LocationPill({
  location,
  places,
  onSavePlaces,
  compact = false,
}: {
  location: Location | null;
  places: Places;
  onSavePlaces: (next: Places) => void;
  /** Phone header with more icons beside it: shorter pill, ZIP digits only. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, , hydrated] = useAppState();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const dialogId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const prefetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saved = places.saved;
  const active = saved.find((s) => s.id === places.activeId) ?? null;
  const whole = active !== null && active.radiusMiles === undefined;
  const radiusText = !active
    ? ""
    : active.radiusMiles === undefined
      ? "Whole city (no radius)"
      : `Within ${milesText(active.radiusMiles)}`;

  // Diálogo modal: fondo inert, Tab atrapado dentro, Escape cierra y el foco vuelve a la píldora.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const pill = pillRef.current;
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child instanceof HTMLElement && dialog && !child.contains(dialog) && !child.hasAttribute("inert")) {
        child.setAttribute("inert", "");
        inerted.push(child);
      }
    }
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (document.documentElement.hasAttribute("data-account-away")) return; // hidden by AccountScope: the keys are for its note
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      for (const el of inerted) el.removeAttribute("inert");
      pill?.focus();
    };
  }, [open]);

  useEffect(() => () => clearTimeout(prefetchTimer.current), []);

  function openSheet() {
    setText("");
    setError(null);
    setNotice(null);
    setConfirmingId(null);
    setOpen(true);
  }

  function schedulePrefetch(entry: SavedLocation | undefined) {
    clearTimeout(prefetchTimer.current);
    if (!entry || entry.lat === undefined || entry.lng === undefined || entry.radiusMiles === undefined) return;
    const id = entry.id;
    prefetchTimer.current = setTimeout(() => prefetchPlaces(id), PREFETCH_DELAY_MS);
  }

  function choose(id: string) {
    setConfirmingId(null);
    onSavePlaces({ ...places, activeId: id });
  }

  function setRadius(id: string, miles: (typeof DISTANCE_STEPS)[number] | undefined) {
    const nextSaved = saved.map((s) => {
      if (s.id !== id) return s;
      const copy: SavedLocation = { ...s };
      if (miles === undefined) delete copy.radiusMiles;
      else copy.radiusMiles = miles;
      return copy;
    });
    onSavePlaces({ ...places, saved: nextSaved });
    schedulePrefetch(nextSaved.find((s) => s.id === id));
  }

  function remove(id: string) {
    const nextActiveId = nextActive(saved, id, places.activeId);
    onSavePlaces({ ...places, saved: saved.filter((s) => s.id !== id), activeId: nextActiveId });
    setConfirmingId(null);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const parsed = parseLocation(text);
    if (!parsed) {
      setError(LOCATION_ERROR);
      return;
    }
    const owner = getIdentity();
    setBusy(true);
    setError(null);
    setNotice(null);
    const outcome = await geocodeLocation(
      parsed.zip ? { zip: parsed.zip } : { city: parsed.city ?? "", state: parsed.state ?? "" },
    );
    setBusy(false);
    if (owner === null || getIdentity() !== owner || !getSnapshot().hydrated) return; // it would not be saved: what was typed stays
    if (outcome.status === "busy") {
      setError(BUSY_COPY);
      return;
    }
    let id = newLocationId();
    while (saved.some((s) => s.id === id)) id = newLocationId();
    const entry: SavedLocation = { id, label: parsed.label };
    if (parsed.zip !== undefined) entry.zip = parsed.zip;
    if (parsed.city !== undefined) entry.city = parsed.city;
    if (parsed.state !== undefined) entry.state = parsed.state;
    if (outcome.status === "ok") {
      entry.lat = outcome.lat;
      entry.lng = outcome.lng;
    } else {
      setNotice(
        parsed.zip !== undefined
          ? "Couldn't place that ZIP; nearby stores won't work for it."
          : "Couldn't place that city; nearby stores won't work for it.",
      );
    }
    onSavePlaces({ ...places, saved: [...saved, entry], activeId: id });
    setText("");
  }

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        onClick={openSheet}
        aria-haspopup="dialog"
        title={location?.label ?? undefined}
        className={compact ? "flex min-h-12 max-w-[116px] items-center gap-1.5 rounded-full bg-basil-soft px-3 text-[15px] text-basil-text sm:max-w-[240px] sm:px-4 sm:text-[16px]" : "flex min-h-12 max-w-[170px] items-center gap-2 rounded-full bg-basil-soft px-4 text-[16px] text-basil-text sm:max-w-[240px]"}
      >
        <span aria-hidden="true">📍</span>
        <span className="truncate font-semibold">{location ? (compact ? location.label.replace(/^ZIP\s+/i, "") : location.label) : compact ? "Location" : "Set your location"}</span>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[24px] border border-line bg-paper p-6 shadow-xl sm:rounded-[24px]"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <h2 id={`${dialogId}-title`} className="text-[28px] leading-tight">
                Where are you cooking?
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-12 shrink-0 text-[18px] font-semibold text-muted underline underline-offset-4"
              >
                Done
              </button>
            </div>

            {saved.length > 0 && (
              <div className="mb-6 grid gap-3">
                <p id={`${dialogId}-saved`} className="text-[18px] font-semibold text-ink">
                  Saved places
                </p>
                <div role="radiogroup" aria-labelledby={`${dialogId}-saved`} className="grid gap-2">
                  {saved.map((s) => {
                    const isActive = s.id === places.activeId;
                    return (
                      <div key={s.id} className="grid gap-2">
                        <div className="flex items-stretch gap-2">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={isActive}
                            onClick={() => choose(s.id)}
                            className={[
                              "flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl border px-4 py-2 text-left",
                              isActive ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink",
                            ].join(" ")}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[18px] font-semibold leading-tight">{s.label}</span>
                              <span className={["block text-[16px]", isActive ? "text-paper/80" : "text-muted"].join(" ")}>
                                {s.radiusMiles === undefined ? "Whole city" : `Within ${milesText(s.radiusMiles)}`}
                              </span>
                            </span>
                            {isActive && (
                              <svg aria-hidden="true" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(s.id)}
                            aria-label={`Remove ${s.label}`}
                            className="flex min-h-14 min-w-14 items-center justify-center rounded-2xl border border-line text-[22px] text-muted"
                          >
                            <span aria-hidden="true">×</span>
                          </button>
                        </div>
                        {confirmingId === s.id && (
                          <div role="group" aria-label={`Remove ${s.label}`} className="grid gap-3 rounded-2xl bg-saffron-soft px-4 py-4">
                            <p className="text-[18px] text-ink">Remove {s.label} from your saved places?</p>
                            <div className="grid grid-cols-2 gap-3">
                              <Button variant="primary" size="md" onClick={() => remove(s.id)}>
                                Yes, remove
                              </Button>
                              <Button variant="ghost" size="md" onClick={() => setConfirmingId(null)}>
                                Keep it
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {active && (
              <section aria-label="Search radius" className="mb-6 grid gap-4 rounded-2xl border border-line p-4">
                <p aria-live="polite" className="text-[20px] font-semibold text-ink">
                  {radiusText}
                </p>
                <input
                  type="range"
                  min={0}
                  max={DISTANCE_STEPS.length - 1}
                  step={1}
                  disabled={whole}
                  value={whole ? DEFAULT_RADIUS_INDEX : DISTANCE_STEPS.indexOf(active.radiusMiles ?? 3)}
                  aria-label="Search radius"
                  aria-valuetext={radiusText}
                  onChange={(e) => setRadius(active.id, DISTANCE_STEPS[Number(e.target.value)])}
                  className="h-12 w-full cursor-pointer accent-tomato disabled:cursor-not-allowed disabled:opacity-40"
                />
                <div className="flex justify-between text-[14px] text-muted">
                  <span>0.5 mi</span>
                  <span>10 mi</span>
                </div>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 text-[18px] text-ink">
                  <input
                    type="checkbox"
                    className="size-6 accent-tomato"
                    checked={whole}
                    onChange={(e) => setRadius(active.id, e.target.checked ? undefined : DISTANCE_STEPS[DEFAULT_RADIUS_INDEX])}
                  />
                  Whole city (no radius)
                </label>
                {active.radiusMiles !== undefined && (
                  <Link
                    href="/near"
                    onClick={() => setOpen(false)}
                    className="inline-flex min-h-12 items-center text-[18px] font-semibold text-tomato underline underline-offset-4"
                  >
                    See stores near you →
                  </Link>
                )}
              </section>
            )}

            {saved.length < MAX_SAVED_LOCATIONS ? (
              <form onSubmit={add} className="grid gap-4 border-t border-line pt-5">
                <Field label="Add a location" error={error}>
                  {(id, describedBy) => (
                    <input
                      ref={firstFieldRef}
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={error ? true : undefined}
                      className={inputClass}
                      value={text}
                      placeholder=""
                      autoComplete="postal-code"
                      onChange={(e) => {
                        setText(e.target.value);
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <p className="text-[15px] leading-snug text-muted">
                  A ZIP or city you add is looked up once on OpenStreetMap (Nominatim) and then remembered. If that lookup fails, a ZIP falls back to a built-in table. The saved location (ZIP or city and its coordinates) is stored in your account.
                </p>
                <Button type="submit" size="md" fullWidth disabled={busy || !hydrated}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </form>
            ) : (
              <p className="border-t border-line pt-5 text-[17px] text-muted">
                You can save up to {MAX_SAVED_LOCATIONS} locations. Remove one to add another.
              </p>
            )}

            {notice && (
              <p role="status" className="mt-5 rounded-2xl bg-saffron-soft px-5 py-4 text-[17px] font-semibold text-ink">
                {notice}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
