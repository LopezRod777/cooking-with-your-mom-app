"use client";

import { DishPhoto } from "@/components/ui/DishPhoto";
import { dayLabels } from "@/components/week/plan-utils";
import { PET_FOODS } from "@/lib/pets/foods";
import { scanRecipe } from "@/lib/pets/classify";
import { alreadyFed, cookFeedEntry, cookFeedId } from "@/lib/pets/feed";
import { dateKey } from "@/lib/pets/energy";
import type { BowlEntry } from "@/lib/pets/bowls";
import type { Pet, Recipe, WeekPlan } from "@/lib/schemas";
import { nameOfKey } from "./PetScan";

const shortName = (foodId: string) => PET_FOODS.find((f) => f.id === foodId)?.shortLabel ?? foodId;
const MAX_RECIPES = 3;

// Recipes of today's day in the plan, in plan order (same lookup as "From today's cooking").
function todayRecipes(plan: WeekPlan | null, now: Date): Recipe[] {
  if (!plan) return [];
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hit = dayLabels(plan).find((l) => l.day.getTime() === todayMs);
  const day = hit ? plan.days.find((d) => d.dayIndex === hit.dayIndex) : undefined;
  if (!day) return [];
  return day.meals.map((m) => plan.recipes[m.recipeId]).filter((r) => Boolean(r));
}

// What the log holds for this recipe today (the entry that was fed), for the "Fed ✓" line.
type Shown = { kcal: number; components?: { foodId: string; grams: number }[] };
function loggedEntry(pet: Pet, recipe: Recipe, now: Date): Shown | null {
  const id = cookFeedId(recipe.id, pet.id, dateKey(now));
  return pet.extrasLog.find((e) => e.id === id) ?? null;
}

// One pan for the family, a plain portion for the pet. Only recipes that give the pet a portion are shown.
// Phones: the "I fed this" button sits under the text. sm and up: it sits inline, to the right.
export function CookForBoth({
  pet,
  plan,
  now,
  full,
  onFed,
}: {
  pet: Pet;
  plan: WeekPlan | null;
  now: Date;
  full: boolean;
  onFed: (entry: BowlEntry) => void;
}) {
  // A recipe shows while its portion can still be logged, or once it is logged today ("Fed ✓" stays).
  const items = todayRecipes(plan, now)
    .map((recipe) => {
      const fed = alreadyFed(pet, cookFeedId(recipe.id, pet.id, dateKey(now)));
      const shown = fed ? loggedEntry(pet, recipe, now) : cookFeedEntry(pet, recipe, now);
      return { recipe, entry: shown, fed };
    })
    .filter((x): x is { recipe: Recipe; entry: Shown; fed: boolean } => x.entry !== null || x.fed)
    .slice(0, MAX_RECIPES);
  if (items.length === 0) return null;

  return (
    <section className="grid content-start gap-4" aria-label="Cook for both">
      <div className="grid gap-1">
        <h2 className="font-display text-[26px] leading-tight">Cook for both</h2>
        <p className="text-[16px] leading-snug text-muted">
          One pan for you, a plain portion for {pet.name}, set aside before salt, oil or sauce.
        </p>
      </div>
      <ul>
        {items.map(({ recipe, entry, fed }) => {
          const hazards = scanRecipe(recipe, pet.species).hazards.map(nameOfKey);
          return (
            <li
              key={recipe.id}
              className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 border-t border-line py-4 sm:grid-cols-[84px_minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="relative h-[84px] w-[84px] overflow-hidden rounded-[16px] bg-saffron-soft">
                <DishPhoto recipe={recipe} sizes="84px" />
              </div>
              <div className="grid min-w-0 gap-1">
                <p className="text-[18px] font-semibold leading-snug">{recipe.title}</p>
                <p className="text-[16px] leading-snug">
                  {pet.name}&apos;s portion:{" "}
                  {entry?.components?.map((p) => `${p.grams} g ${shortName(p.foodId).toLowerCase()}`).join(" · ")}
                </p>
                <p className="text-[15px] leading-snug text-muted">
                  {hazards.length > 0 && `Keep it away from ${hazards.join(", ")}. `}
                  {!fed && entry && `${entry.kcal} kcal.`}
                </p>
              </div>
              {fed ? (
                <p className="col-span-2 flex min-h-12 w-full items-center justify-center rounded-full border border-ink/25 px-4 text-[17px] font-semibold text-muted sm:col-span-1 sm:w-auto sm:justify-self-end">
                  Fed ✓ · {entry?.kcal ?? 0} kcal
                </p>
              ) : (
                <button
                  type="button"
                  disabled={full}
                  onClick={() => {
                    const feed = cookFeedEntry(pet, recipe, now);
                    if (feed) onFed(feed);
                  }}
                  className="col-span-2 min-h-12 w-full rounded-full border border-ink/25 bg-paper px-4 text-[17px] font-semibold text-ink disabled:opacity-40 sm:col-span-1 sm:w-auto sm:justify-self-end"
                >
                  I fed this
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
