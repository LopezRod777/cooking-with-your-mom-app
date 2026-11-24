"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DishPhoto } from "@/components/ui/DishPhoto";
import { btnPrimary } from "@/components/week/classes";
import { SLOT_LABELS } from "@/components/week/plan-utils";
import type { AppState, Recipe } from "@/lib/schemas";
import { flush, getSnapshot, saveState } from "@/lib/store";
import { useAppState } from "@/lib/useAppState";
import { BottleScan } from "./BottleScan";
import { PairingCard } from "./PairingCard";
import { UnlockScreen } from "./UnlockScreen";
import {
  cachePairing,
  currentEpoch,
  getCachedPairing,
  refresh,
  unlock,
  usePairingsGate,
  type PairingResult,
} from "./usePairingsGate";

const own = <T,>(map: Record<string, T> | undefined, key: string): T | undefined =>
  map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

function findRecipe(state: AppState, id: string): Recipe | undefined {
  return own(state.plan?.recipes, id) ?? own(state.favoriteRecipes, id);
}

// The store's copy is written to the server before the pairing is asked for; this confirms it from the server.
async function confirmSaved(recipeId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await flush();
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { state?: { favoriteRecipes?: Record<string, unknown> } | null } | null;
      if (res.ok && own(json?.state?.favoriteRecipes, recipeId) !== undefined && !getSnapshot().sync.dirty) {
        return true;
      }
    } catch {
      // Network trouble counts as not confirmed; the next attempt tries again.
    }
  }
  return false;
}

type View =
  | { kind: "loading" }
  | { kind: "ready"; result: PairingResult; busy: boolean }
  | { kind: "error"; message: string };

const ERROR_COPY: Record<number, Record<string, string>> = {
  404: { unknown_recipe: "Save your recipe first." },
  409: { busy: "Still working on the last one. Give it a moment.", lease_lost: "That one got interrupted. Try again." },
  422: { no_confident_pairing: "Mama has no confident pairing for this one yet." },
  429: { quota: "You've used today's pairings. Try again tomorrow." },
};

async function askServer(recipeId: string, force: boolean): Promise<{ ok: true; result: PairingResult } | { ok: false; status: number; error: string }> {
  const epoch = currentEpoch();
  if (!force) {
    const cached = getCachedPairing(recipeId);
    if (cached) return { ok: true, result: cached };
    const res = await fetch(`/api/pair?recipeId=${encodeURIComponent(recipeId)}`, { cache: "no-store" });
    if (res.ok) {
      const result = (await res.json()) as PairingResult;
      cachePairing(result, epoch);
      return { ok: true, result };
    }
    if (res.status !== 404) return failure(res);
  }
  const res = await fetch("/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipeId }),
  });
  if (!res.ok) return failure(res);
  const result = (await res.json()) as PairingResult;
  cachePairing(result, epoch);
  return { ok: true, result };
}

async function failure(res: Response) {
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return { ok: false as const, status: res.status, error: json?.error ?? "" };
}

// Weekly drinks budget (null = not set). Shared with Settings, which saves it with its own "Save changes".
export function DrinksBudgetField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <label htmlFor="drinks-budget" className="text-[18px] font-semibold leading-snug text-ink">
        How much for drinks a week?
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-h-12 items-center gap-2 rounded-full border border-ink/25 bg-white px-4 focus-within:outline focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-saffron">
          <span aria-hidden="true" className="text-[18px] text-muted">
            $
          </span>
          <input
            id="drinks-budget"
            type="number"
            inputMode="numeric"
            min={0}
            max={300}
            step={1}
            autoFocus={autoFocus}
            value={value ?? ""}
            placeholder="0"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange(null);
                return;
              }
              const n = Number(raw);
              if (Number.isInteger(n) && n >= 0 && n <= 300) onChange(n);
            }}
            className="min-h-12 w-24 bg-transparent text-[18px] text-ink outline-none"
          />
          <span aria-hidden="true" className="text-[16px] text-muted">
            a week
          </span>
        </div>
        <Button variant="ghost" size="md" onClick={() => onChange(null)}>
          Not set
        </Button>
      </div>
    </div>
  );
}

function PairingFlow({ recipe }: { recipe: Recipe }) {
  const gate = usePairingsGate();
  const [view, setView] = useState<View>({ kind: "loading" });

  // Applies one answer. Called only from promise callbacks, never synchronously in an effect body.
  function settle(out: Awaited<ReturnType<typeof askServer>>) {
    if (out.ok) {
      setView({ kind: "ready", result: out.result, busy: false });
      return;
    }
    if (out.status === 403) {
      void refresh();
      return;
    }
    const message = ERROR_COPY[out.status]?.[out.error] ?? "Mama is taking a break. Try again in a bit.";
    setView({ kind: "error", message });
  }

  function fail() {
    setView({ kind: "error", message: "Check your connection and try again." });
  }

  useEffect(() => {
    let alive = true;
    const epoch = currentEpoch();
    askServer(recipe.id, false).then(
      (out) => {
        if (alive && epoch === currentEpoch()) settle(out);
      },
      () => {
        if (alive && epoch === currentEpoch()) fail();
      },
    );
    return () => {
      alive = false;
    };
    // Loads once per recipe; "Pair again" and "Try again" call askServer(recipe.id, true) directly.
  }, [recipe.id]);

  function again(force: true) {
    const epoch = currentEpoch();
    setView((v) => (v.kind === "ready" ? { ...v, busy: true } : { kind: "loading" }));
    askServer(recipe.id, force).then(
      (out) => {
        if (epoch === currentEpoch()) settle(out);
      },
      () => {
        if (epoch === currentEpoch()) fail();
      },
    );
  }

  if (view.kind === "loading") {
    return (
      <p role="status" className="text-[18px] text-muted">
        Mama is thinking about what goes with {recipe.title}…
      </p>
    );
  }
  if (view.kind === "error") {
    return (
      <div className="grid gap-4">
        <p role="status" className="text-[18px] leading-snug">
          {view.message}
        </p>
        {gate.unlocked && (
          <div>
            <Button
              variant="ghost"
              size="md"
              onClick={() => again(true)}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <PairingCard
      result={view.result}
      slot={recipe.slot}
      busy={view.busy}
      onPairAgain={() => again(true)}
    />
  );
}

export function PairingsPage({ initialRecipeId }: { initialRecipeId?: string }) {
  const gate = usePairingsGate();
  const { sessionId } = useAuth();
  const [state, setState, hydrated] = useAppState();
  const router = useRouter();
  const [editingBudget, setEditingBudget] = useState(false);
  // "Yes, I'm 21+" in onboarding or Settings stands for the self-declaration: a locked session (new sign-in, new
  // device) is opened again without asking. If the server refuses, the unlock screen shows as before.
  const firstAge = state.people[0]?.age ?? null;
  const autoUnlock = hydrated && (state.profile.drinkPairings === true || (firstAge !== null && firstAge >= 21));
  const [autoFailed, setAutoFailed] = useState(false);
  const opening = autoUnlock && gate.known && !gate.unlocked && !gate.lockError && !autoFailed;
  useEffect(() => {
    if (!opening) return;
    let alive = true;
    void unlock().then((ok) => {
      if (alive && !ok) setAutoFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [opening]);

  if (!gate.known || !hydrated) {
    return <p className="text-[18px] text-muted">Loading…</p>;
  }
  if (opening) {
    return (
      <p role="status" className="text-[18px] text-muted">
        Opening pairings…
      </p>
    );
  }
  if (!gate.unlocked) {
    // lock() closes the gate before the server answers, so the notice has to show on the unlock screen.
    return (
      <>
        {gate.lockError && (
          <p role="status" className="mx-auto mb-6 w-full max-w-5xl text-[18px] leading-snug">
            Couldn&apos;t lock on the server. Sign out to be safe.
          </p>
        )}
        <UnlockScreen />
      </>
    );
  }

  const recipe = initialRecipeId ? findRecipe(state, initialRecipeId) : undefined;
  const planned = state.plan
    ? state.plan.days.flatMap((d) =>
        d.meals.map((m) => ({ meal: m, recipe: own(state.plan?.recipes, m.recipeId) })),
      )
    : [];

  const budget = state.profile.drinksBudgetUsd;
  const budgetLine = budget === null ? "Your drinks budget: not set" : `Your drinks budget: $${budget} a week`;
  function setDrinksBudget(v: number | null) {
    const next: AppState = { ...state, profile: { ...state.profile, drinksBudgetUsd: v } };
    setState(next);
    saveState(next);
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8">
      <header className="flex items-start justify-between gap-4">
        {recipe ? (
          <div className="grid gap-3">
            <Link href="/pairings" className="inline-flex min-h-12 items-center text-[18px] font-semibold text-muted hover:text-ink">
              ‹ Back
            </Link>
            <p data-drinks-budget className="text-[17px] text-ink">
              {budgetLine}
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <h1 className="text-[40px] leading-[1.1]">
              Pairings <em className="italic text-tomato">21+</em>
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 text-[17px] text-ink">
              <span>{budgetLine}</span>
              <button
                type="button"
                onClick={() => setEditingBudget(true)}
                className="min-h-12 font-semibold text-muted underline underline-offset-4 hover:text-ink"
              >
                Change
              </button>
            </p>
            {editingBudget && (
              <div className="grid gap-3">
                <DrinksBudgetField value={budget} onChange={setDrinksBudget} autoFocus />
                <div>
                  <Button variant="ghost" size="md" onClick={() => setEditingBudget(false)}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {recipe ? (
        <section aria-label={`Pairings for ${recipe.title}`} className="grid gap-6">
          <div className="grid gap-1">
            <h2 className="text-[32px] leading-tight">{recipe.title}</h2>
            <p className="text-[16px] text-muted">{SLOT_LABELS[recipe.slot]}</p>
          </div>
          <PairingFlow key={recipe.id} recipe={recipe} />
        </section>
      ) : (
        <>
          <BottleScan plan={state.plan} sessionId={sessionId ?? ""} />

          <section aria-labelledby="week-title" className="grid gap-4">
            <h2 id="week-title" className="text-[28px] leading-tight">
              This week&apos;s meals
            </h2>
            {planned.length === 0 ? (
              <p className="text-[18px] text-muted">
                No plan yet. <Link href="/" className="underline underline-offset-4">Plan your week</Link>, or paste a recipe link below.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {planned.map(({ meal, recipe: r }, i) =>
                  r ? (
                    <li key={`${meal.recipeId}-${i}`} className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div data-testid="pairings-row-photo" className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-line">
                          <DishPhoto recipe={r} sizes="56px" />
                        </div>
                        <div className="grid min-w-0 gap-0.5">
                          <span className="text-[18px] font-semibold text-ink">{r.title}</span>
                          <span className="text-[15px] text-muted">{SLOT_LABELS[meal.slot]}</span>
                        </div>
                      </div>
                      <Link href={`/pairings?recipe=${encodeURIComponent(r.id)}`} className={`${btnPrimary} shrink-0 whitespace-nowrap`}>
                        Pair it
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </section>
        </>
      )}

      <p className="pb-6 text-[15px] text-muted">Drink responsibly.</p>
    </div>
  );
}
