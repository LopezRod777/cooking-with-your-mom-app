"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { DishPhoto } from "@/components/ui/DishPhoto";
import { useAppState } from "@/lib/useAppState";
import { dayLabels } from "@/components/week/plan-utils";
import {
  dateKey,
  extrasBudget,
  extrasRemaining,
  pruneExtrasLog,
  stage,
  dailyKcal,
  gramsGivenToday,
  logIsFull,
} from "@/lib/pets/energy";
import { foodsFor, gramsThatFit, type PetFood } from "@/lib/pets/foods";
import { allowedFoods, blockedInfo, foodAllowed } from "@/lib/pets/restrictions";
import { buildBowlEntry, type BowlEntry } from "@/lib/pets/bowls";
import { appendFeed } from "@/lib/pets/feed";
import type { PetSpecies } from "@/lib/pets/classify";
import type { Pet, WeekPlan } from "@/lib/schemas";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BreedNotes } from "./BreedNotes";
import { CookForBoth } from "./CookForBoth";
import { PetBowls } from "./PetBowls";
import { PetForm } from "./PetForm";
import { PetHero } from "./PetHero";
import { PetSips } from "./PetSips";
import { HazardBadges, ScanRows, SPECIES_NOUN } from "./PetScan";
import { ShareChips } from "./ShareChips";
import { VetCorner } from "./VetCorner";

type ExtrasEntry = Pet["extrasLog"][number];

const newEntryId = () => Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join("");

const MAX_PETS = 6;

const pad = (n: number) => String(n).padStart(2, "0");

// Day clock: fires at local midnight and whenever the tab regains focus or visibility, so an open
// page rolls over to the new day. The snapshot is the local date string, so re-renders happen only on a day change.
function subscribeDay(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    timer = setTimeout(() => {
      onChange();
      schedule();
    }, Math.max(1000, nextMidnight - now.getTime()));
  };
  const onWake = () => onChange();
  schedule();
  window.addEventListener("focus", onWake);
  document.addEventListener("visibilitychange", onWake);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", onWake);
    document.removeEventListener("visibilitychange", onWake);
  };
}

const todaySnapshot = () => dateKey(new Date());

type Mode = { kind: "closed" } | { kind: "add" } | { kind: "edit"; id: string };

export function PetsPage() {
  const [state, setState, hydrated] = useAppState();
  // Onboarding left a first-pet card to finish: the add form opens pre-filled until it is saved.
  const intro = state.pets.length === 0 ? state.profile.petIntro : null;
  const [mode, setMode] = useState<Mode>(() => (intro ? { kind: "add" } : { kind: "closed" }));
  const [introOpened, setIntroOpened] = useState(intro !== null);
  if (intro && !introOpened) {
    setIntroOpened(true);
    setMode({ kind: "add" });
  }
  const [removing, setRemoving] = useState<string | null>(null);

  // The clock is read on the client only: the snapshot is the local day (a stable string), so prerender
  // gets null and the first client render gets today's date without an effect.
  const todayKey = useSyncExternalStore(subscribeDay, todaySnapshot, () => null);
  const now = todayKey === null ? null : new Date();

  const ready = hydrated && now !== null;
  const pets = state.pets;

  function savePet(pet: Pet) {
    setState((prev) => {
      const exists = prev.pets.some((p) => p.id === pet.id);
      const next = exists ? prev.pets.map((p) => (p.id === pet.id ? pet : p)) : [...prev.pets, pet];
      // The onboarding card is done once any pet is saved.
      const profile = prev.profile.petIntro ? { ...prev.profile, petIntro: null } : prev.profile;
      return { ...prev, pets: next, profile };
    });
    setMode({ kind: "closed" });
  }

  function removePet(id: string) {
    const removed = pets.find((p) => p.id === id);
    setState((prev) => ({ ...prev, pets: prev.pets.filter((p) => p.id !== id) }));
    // The photo lives outside app state, so drop its blob too (best effort; keepalive lets it finish after navigation).
    if (removed?.photo) {
      fetch(`/api/pets/photo?petId=${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => {});
    }
    setRemoving(null);
    setMode((m) => (m.kind === "edit" && m.id === id ? { kind: "closed" } : m));
  }

  // Records one "I gave this". The grams are recomputed from the remaining budget inside the
  // update, so two quick taps cannot push a pet past its budget. Restrictions and the log cap are re-checked here too.
  function giveFood(petId: string, food: PetFood) {
    const at = new Date();
    setState((prev) => ({
      ...prev,
      pets: prev.pets.map((p) => {
        if (p.id !== petId) return p;
        const pruned = pruneExtrasLog(p, at);
        const today = dateKey(at);
        if (!foodAllowed(pruned, food.id) || logIsFull(pruned, today)) return pruned;
        const grams = gramsThatFit(
          food,
          extrasRemaining(pruned, at),
          pruned.species,
          gramsGivenToday(pruned, food.id, today),
        );
        if (grams <= 0) return pruned;
        const kcal = Math.ceil((grams * food.kcalPer100g) / 100);
        const entry = {
          id: newEntryId(),
          date: today,
          kcal,
          label: `${grams} g ${food.shortLabel}`.slice(0, 60),
          foodId: food.id,
          grams,
        };
        return pruneExtrasLog({ ...pruned, extrasLog: [...pruned.extrasLog, entry] }, at);
      }),
    }));
  }

  // Records one bowl as ONE log entry, after re-checking restrictions, budget, caps and the log cap.
  function feedBowl(petId: string, bowlId: string) {
    const at = new Date();
    setState((prev) => ({
      ...prev,
      pets: prev.pets.map((p) => {
        if (p.id !== petId) return p;
        const pruned = pruneExtrasLog(p, at);
        const entry = buildBowlEntry(pruned, bowlId, at, newEntryId);
        if (!entry) return pruned;
        return pruneExtrasLog({ ...pruned, extrasLog: [...pruned.extrasLog, entry] }, at);
      }),
    }));
  }

  // Records one "Cook for both" portion as ONE log entry, re-checked against the pet as it is in state now.
  function feedCookForBoth(petId: string, entry: BowlEntry) {
    const at = new Date();
    setState((prev) => ({ ...prev, pets: prev.pets.map((p) => {
      if (p.id !== petId) return p;
      return appendFeed(pruneExtrasLog(p, at), entry, at);
    }) }));
  }

  // Removes one entry logged today: by id when it has one (bowls), otherwise the most recent match.
  function undoExtra(petId: string, entry: ExtrasEntry) {
    setState((prev) => ({
      ...prev,
      pets: prev.pets.map((p) => {
        if (p.id !== petId) return p;
        if (entry.id !== undefined) {
          const withId = p.extrasLog.findIndex((e) => e.id === entry.id);
          return withId < 0 ? p : { ...p, extrasLog: p.extrasLog.filter((_, j) => j !== withId) };
        }
        const i = p.extrasLog.map((e) => e.date === entry.date && e.kcal === entry.kcal && e.label === entry.label).lastIndexOf(true);
        if (i < 0) return p;
        return { ...p, extrasLog: p.extrasLog.filter((_, j) => j !== i) };
      }),
    }));
  }

  const editing = mode.kind === "edit" ? pets.find((p) => p.id === mode.id) ?? null : null;
  const formOpen = mode.kind === "add" || (mode.kind === "edit" && editing !== null);
  const canAdd = pets.length < MAX_PETS;
  const showPets = ready && pets.length > 0;

  return (
    <div className="grid gap-8 pb-32 lg:pb-8">
      <header className="grid gap-2">
        <h1 className="font-display text-[40px] leading-tight">Pets</h1>
        <p className="text-[18px] leading-snug text-muted">
          Extras and simple bowls, sized for each pet. Ask your vet before changing their food.
        </p>
      </header>

      {!showPets && (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start xl:gap-10">
          <div className="grid content-start gap-8">
            {ready && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <SpeciesCard
                    title="Dogs"
                    species="dog"
                    extra="Extras stay under 10% of the day (our conservative rule)"
                  />
                  <SpeciesCard
                    title="Cats"
                    species="cat"
                    extra="Extras stay under 10% of the day (our conservative rule)"
                  />
                </div>
                {mode.kind === "add" ? (
                  <PetForm
                    initial={null}
                    prefill={intro}
                    currentMonth={monthKey(now!)}
                    onSave={savePet}
                    onCancel={() => setMode({ kind: "closed" })}
                  />
                ) : (
                  <div>
                    <Button onClick={() => setMode({ kind: "add" })} className="min-h-12">
                      Add a pet
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="grid content-start gap-8">
            <VetCorner />
          </div>
        </div>
      )}

      {showPets && (
        <>
          {mode.kind === "add" && (
            <PetForm initial={null} currentMonth={monthKey(now!)} onSave={savePet} onCancel={() => setMode({ kind: "closed" })} />
          )}
          {pets.map((pet) =>
            mode.kind === "edit" && mode.id === pet.id ? (
              <PetForm
                key={pet.id}
                initial={pet}
                currentMonth={monthKey(now!)}
                onSave={savePet}
                onCancel={() => setMode({ kind: "closed" })}
              />
            ) : (
              <PetBlock
                key={pet.id}
                pet={pet}
                trailing={pets[pets.length - 1].id === pet.id ? (
                  <>
                    <TodayCooking plan={state.plan} now={now!} pets={pets} />
                    <VetCorner />
                  </>
                ) : null}
                now={now!}
                plan={state.plan}
                confirming={removing === pet.id}
                editDisabled={formOpen}
                onEdit={() => {
                  setRemoving(null);
                  setMode({ kind: "edit", id: pet.id });
                }}
                onAskRemove={() => setRemoving(pet.id)}
                onCancelRemove={() => setRemoving(null)}
                onConfirmRemove={() => removePet(pet.id)}
                onGive={(food) => giveFood(pet.id, food)}
                onFeedBowl={(bowlId) => feedBowl(pet.id, bowlId)}
                onFeedCook={(entry) => feedCookForBoth(pet.id, entry)}
                onUndo={(entry) => undoExtra(pet.id, entry)}
              />
            ),
          )}
          {!canAdd && <p className="text-[17px] text-muted">Six pets is the limit here.</p>}

          {!formOpen && canAdd && (
            <div>
              <Button onClick={() => setMode({ kind: "add" })} className="min-h-12">
                Add a pet
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SpeciesCard({ title, species, extra }: { title: string; species: PetSpecies; extra: string }) {
  const labels = foodsFor(species)
    .slice(0, 5)
    .map((f) => f.shortLabel);
  return (
    <Card className="grid content-start gap-4">
      <h2 className="font-display text-[28px] leading-tight">{title}</h2>
      <ul className="grid gap-3 text-[18px] leading-snug">
        <li>Can share, plain and cooked: {labels.join(", ")}</li>
        <li>Never: onion, garlic, grapes, chocolate</li>
        <li>{extra}</li>
      </ul>
    </Card>
  );
}

// One pet: the hero panel, then its sections. Sections are hidden when the pet is too young or blocked.
function PetBlock({
  pet,
  now,
  plan,
  confirming,
  editDisabled,
  onEdit,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
  onGive,
  onFeedBowl,
  onFeedCook,
  onUndo,
  trailing,
}: {
  pet: Pet;
  now: Date;
  plan: WeekPlan | null;
  trailing: ReactNode;
  confirming: boolean;
  editDisabled: boolean;
  onEdit: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
  onGive: (food: PetFood) => void;
  onFeedBowl: (bowlId: string) => void;
  onFeedCook: (entry: BowlEntry) => void;
  onUndo: (entry: ExtrasEntry) => void;
}) {
  const s = stage(pet, now);
  const budget = extrasBudget(pet, now);
  const remaining = extrasRemaining(pet, now);
  const mer = dailyKcal(pet, now).mer;
  const blocked = blockedInfo(pet);
  const today = dateKey(now);
  const full = logIsFull(pet, today);
  const showSections = s !== "too_young" && !blocked;
  // Bowl and cook-for-both entries (no single food). Single-food chips are undone from their chip.
  const loggedBowls = pet.extrasLog.filter((e) => e.date === today && e.foodId === undefined);

  return (
    <div data-testid="pet-block" className="grid gap-8">
      <PetHero
        pet={pet}
        now={now}
        stage={s}
        mer={mer}
        budgetKcal={budget.kcal}
        budgetRule={budget.rule}
        remaining={remaining}
        blocked={blocked}
        confirming={confirming}
        editDisabled={editDisabled}
        onEdit={onEdit}
        onAskRemove={onAskRemove}
        onCancelRemove={onCancelRemove}
        onConfirmRemove={onConfirmRemove}
      />
      <BreedNotes pet={pet} now={now} />

      {(showSections || trailing) && (
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start xl:gap-10">
          <div className="grid content-start gap-8">
            {showSections && (
              <>
            <ShareChips
              pet={pet}
              foods={allowedFoods(pet)}
              now={now}
              full={full}
              onGive={onGive}
              onUndo={onUndo}
            />
            <PetBowls pet={pet} now={now} full={full} onFed={onFeedBowl} />
            <PetSips pet={pet} />
            {loggedBowls.length > 0 && (
              <div className="grid gap-2">
                <p className="text-[15px] font-semibold text-muted">Logged today</p>
                <ul className="grid gap-2">
                  {loggedBowls.map((entry, i) => (
                    <li
                      key={entry.id ?? `${i}-${entry.label}`}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-t border-line py-2"
                    >
                      <span className="min-w-0 text-[17px] leading-snug">
                        {entry.label} · {entry.kcal} kcal
                      </span>
                      <button
                        type="button"
                        onClick={() => onUndo(entry)}
                        className="min-h-12 rounded-full border border-ink/25 bg-paper px-4 text-[17px] font-semibold text-ink"
                      >
                        Undo
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
              </>
            )}
          </div>
          <div className="grid content-start gap-8">
            {showSections && <CookForBoth pet={pet} plan={plan} now={now} full={full} onFed={onFeedCook} />}
            {trailing}
          </div>
        </div>
      )}
    </div>
  );
}

function TodayCooking({
  plan,
  now,
  pets,
}: {
  plan: WeekPlan | null;
  now: Date;
  pets: Pet[];
}) {
  const section = (children: ReactNode) => (
    <section className="grid content-start gap-4" aria-label="From today's cooking">
      <h2 className="font-display text-[26px] leading-tight">From today&apos;s cooking</h2>
      {children}
    </section>
  );
  if (!plan) return section(<p className="text-[17px] text-muted">No plan for today.</p>);

  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hit = dayLabels(plan).find((l) => l.day.getTime() === todayMs);
  const day = hit ? plan.days.find((d) => d.dayIndex === hit.dayIndex) : undefined;
  if (!day) return section(<p className="text-[17px] text-muted">No plan for today.</p>);

  const recipes = day.meals.map((m) => plan.recipes[m.recipeId]).filter((r) => Boolean(r));
  if (recipes.length === 0) return section(<p className="text-[17px] text-muted">No meals planned for today.</p>);

  const species = speciesIn(pets);
  return section(
    <ul className="grid gap-4">
      {recipes.map((recipe) => (
        <li key={recipe.id} className="grid gap-3 rounded-[20px] border border-line bg-panel p-4">
          <div className="flex items-start gap-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-line">
              <DishPhoto recipe={recipe} sizes="64px" />
            </div>
            <p className="text-[19px] font-semibold leading-snug">
              {recipe.title}
              <HazardBadges recipe={recipe} species={species} />
            </p>
          </div>
          {species.map((sp) => (
            <div key={sp} className="grid gap-1">
              {species.length > 1 && <p className="text-[15px] font-semibold text-muted">For your {SPECIES_NOUN[sp]}</p>}
              <ScanRows recipe={recipe} pets={pets.filter((p) => p.species === sp)} />
            </div>
          ))}
          <p className="text-[15px] font-semibold leading-snug text-tomato">
            Cook the pet&apos;s piece separately: plain, no salt, no oil, no sauce. Never from the seasoned pan.
          </p>
        </li>
      ))}
    </ul>,
  );
}

function speciesIn(pets: Pet[]): PetSpecies[] {
  return Array.from(new Set(pets.map((p) => p.species)));
}

function monthKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}
