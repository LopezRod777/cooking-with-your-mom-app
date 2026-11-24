"use client";

import Link from "next/link";
import { needsLine } from "@/lib/ai/kitchen";
import type { PlannedMeal, Recipe } from "@/lib/schemas";
import { SLOT_PILL, btnSwap } from "./classes";
import { DishPhoto } from "../ui/DishPhoto";
import { HeartButton } from "./HeartButton";
import { formatPerServingAvg } from "@/lib/prices";
import { drinkProteinG } from "@/lib/nutrition";
import { useOffline } from "@/lib/offline/useOffline";
import {
  SLOT_LABELS,
  mealCostPerServingAvg,
  minutesOf,
  proteinLabel,
} from "./plan-utils";

export function MealCard({
  timeHint,
  meal,
  recipe,
  favorite,
  breaksDiet = null,
  showDrink,
  onToggleFavorite,
  onSwap,
}: {
  meal: PlannedMeal;
  timeHint?: string;
  recipe: Recipe;
  favorite: boolean;
  // Lowercased diet label when this recipe breaks the profile's diet (shown, never hidden): "vegan", "carnivore".
  breaksDiet?: string | null;
  // profile.mealDrinks: the plan's drink shows only when on; off hides it even if the saved plan has one.
  showDrink: boolean;
  onToggleFavorite: () => void;
  onSwap: () => void;
}) {
  const offline = useOffline();
  const drink = showDrink ? meal.drink : null;
  const drinkProtein = drink ? drinkProteinG(drink, meal.servings) : null;
  const costPerServing = mealCostPerServingAvg(recipe, meal.servings);
  return (
    <article className="relative grid overflow-hidden rounded-[24px] border border-line bg-paper">
      <div className="relative aspect-[4/3] bg-saffron-soft">
        <DishPhoto
          recipe={recipe}
          sizes="(min-width: 1200px) 360px, (min-width: 768px) 50vw, 100vw"
        />
        <HeartButton
          pressed={favorite}
          onToggle={onToggleFavorite}
          className="absolute right-3 top-3 z-10"
        />
      </div>
      <div className="grid content-start gap-2 p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span data-testid="slot-pill" className={`rounded-full px-3 py-1 text-[15px] font-semibold ${SLOT_PILL[meal.slot]}`}>
              {SLOT_LABELS[meal.slot]}
            </span>
            {timeHint && (
              <span data-testid="time-hint" className="truncate text-[15px] text-muted">
                {timeHint}
              </span>
            )}
          </span>
          <span className="text-[17px] text-muted">{minutesOf(recipe)} min</span>
        </div>
        <h3 className="font-display text-[24px] leading-tight">
          <Link
            href={`/recipe/${recipe.id}`}
            className="rounded-sm after:absolute after:inset-0 after:content-['']"
          >
            {recipe.title}
          </Link>
        </h3>
        {recipe.needsEquipment?.length ? (
          <span
            data-testid="needs-equipment"
            className="w-fit rounded-md border border-tomato/50 bg-[#fde7e2] px-3 py-1 text-[15px] font-semibold text-tomato"
          >
            {needsLine(recipe.needsEquipment) + " · you marked none"}
          </span>
        ) : null}
        {breaksDiet ? (
          <span
            data-testid="breaks-diet"
            className="w-fit rounded-md border border-tomato/50 bg-[#fde7e2] px-3 py-1 text-[15px] font-semibold text-tomato"
          >
            Not {breaksDiet} · swap it
          </span>
        ) : null}
        <p className="flex flex-wrap items-baseline gap-x-3 text-[18px]">
          <span className="font-semibold">{proteinLabel(recipe, meal.servings)}</span>
          {costPerServing !== null && (
            <span className="text-muted">{formatPerServingAvg(costPerServing)}</span>
          )}
        </p>
        {drink && (
          <p data-testid="meal-drink" className="text-[16px] leading-snug text-muted">
            With it: <span className="font-semibold text-ink">{drink.name}</span>
            {drinkProtein !== null ? ` · ${drinkProtein} g protein` : ""} · about {drink.sugarG} g sugar
          </p>
        )}
        <button
          type="button"
          onClick={onSwap}
          disabled={offline}
          aria-label={`Swap ${recipe.title}`}
          className={`${btnSwap} relative z-10 mt-1 justify-self-start disabled:opacity-60`}
        >
          {offline ? "Swap · needs signal" : "Swap"}
        </button>
      </div>
    </article>
  );
}
