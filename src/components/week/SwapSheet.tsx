"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CheckIn, Pet, Person, Profile, Recipe, type Location } from "@/lib/schemas";
import { btnGhost, btnPrimary } from "./classes";
import { planPets } from "@/lib/pets/planPets";
import { checkinsForRequest, peopleForRequest } from "@/lib/people";
import { postJson, minutesOf, proteinLabel } from "./plan-utils";

type Phase = "waiting" | "ready" | "error";

const SwapResponse = z.object({ recipes: z.array(Recipe) });
const NO_SWAP_FITS = "Mama couldn't find a swap that fits your kitchen. Try again.";

export function SwapSheet({
  recipe,
  otherTitles,
  profile,
  location,
  pets,
  people,
  checkins,
  onChoose,
  onClose,
}: {
  recipe: Recipe;
  otherTitles: string[];
  profile: Profile;
  location: Location | null;
  pets: Pet[];
  people: Person[];
  checkins: CheckIn[];
  onChoose: (next: Recipe) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [options, setOptions] = useState<Recipe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const started = useRef(false);

  const run = useCallback(async () => {
    setPhase("waiting");
    setError(null);
    try {
      const data = await postJson("/api/swap", {
        profile,
        location,
        recipe,
        otherTitles,
        pets: planPets(pets),
        people: peopleForRequest(people),
        checkins: checkinsForRequest(checkins),
      });
      const parsed = SwapResponse.safeParse(data);
      if (!parsed.success) throw new Error("Mama's options came back a little wrong.");
      if (parsed.data.recipes.length === 0) {
        setError(NO_SWAP_FITS);
        setPhase("error");
        return;
      }
      setOptions(parsed.data.recipes);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }, [profile, location, recipe, otherTitles, pets, people, checkins]);

  // Runs once per mount; the ref guards against the double effect in dev.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    opener.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    void run();
    return () => opener.current?.focus();
  }, [run]);

  // Document-level so Escape and Tab work wherever focus lands (focus drops to body when a button is replaced).
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panelRef.current.contains(active);
      if (!inside) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-title"
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 grid max-h-[85vh] content-start gap-5 overflow-y-auto rounded-t-[28px] border-t border-line bg-paper px-6 pb-8 pt-6 outline-none lg:inset-x-auto lg:left-1/2 lg:w-[min(40rem,100vw)] lg:-translate-x-1/2 lg:rounded-[28px] lg:border"
      >
        <h2 id="swap-title" className="font-display text-[30px] leading-tight">
          Swap {recipe.title}?
        </h2>

        {phase === "waiting" && (
          <div className="grid gap-4">
            <p className="text-[20px] text-ink">Mama&apos;s thinking…</p>
            <div
              role="progressbar"
              aria-label="Finding swaps"
              className="h-2 w-full overflow-hidden rounded-full bg-line"
            >
              <span className="cwym-indeterminate block h-full w-1/3 rounded-full bg-tomato" />
            </div>
            <p className="text-[18px] text-muted">Usually about 45 seconds.</p>
          </div>
        )}

        {phase === "error" && (
          <div className="grid gap-3">
            <p role="alert" className="text-[18px] leading-snug text-muted">
              {error}
            </p>
            <button type="button" className={`${btnPrimary} justify-self-start`} onClick={run}>
              Try again
            </button>
          </div>
        )}

        {phase === "ready" && (
          <ul className="grid gap-3">
            {options.map((option) => (
              <li
                key={option.id}
                className="flex items-center justify-between gap-4 rounded-2xl border-2 border-line p-4"
              >
                <div className="min-w-0">
                  <p className="font-display text-[21px] leading-tight">{option.title}</p>
                  <p className="mt-1 text-[17px] text-muted">
                    {proteinLabel(option, option.servings)} · {minutesOf(option)} min
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Use ${option.title}`}
                  className={`${btnPrimary} flex-none px-5`}
                  onClick={() => onChoose(option)}
                >
                  Use this
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className={`${btnGhost} w-full`} onClick={onClose}>
          Keep this one
        </button>
      </div>
    </div>
  );
}
