"use client";

import { drinkProteinG } from "@/lib/nutrition";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { HealthierIdeas, SourceVideo } from "../import/ImportFlow";
import { CATALOG } from "@/lib/catalog";
import { needsLine } from "@/lib/ai/kitchen";
import { isFavorite, toggleFavorite } from "@/lib/favorites";
import { perServing, scaleRecipe } from "@/lib/nutrition";
import { peopleFor } from "@/lib/people";
import type { Person } from "@/lib/schemas";
import { WhoIsEating, tablePeople, withCompanion } from "../people/WhoIsEating";
import { PlatesCard, kidNoteFor } from "./PlatesCard";
import { BasedOn } from "./BasedOn";
import { useOffline } from "@/lib/offline/useOffline";
import { useAppState } from "@/lib/useAppState";
import { DishPhoto } from "../ui/DishPhoto";
import { Stepper } from "../ui/Stepper";
import { StickyNote } from "../ui/StickyNote";
import { HeartButton } from "../week/HeartButton";
import { btnGhost, btnPrimary } from "../week/classes";
import { usePairingsGate } from "../pairings/usePairingsGate";
import { PRICES, formatAvg } from "@/lib/prices";
import { proportionalCostUsd } from "@/lib/grocery";
import { SLOT_LABELS, mealCostPerServingAvg, minutesOf } from "../week/plan-utils";
import { ScanRows, SPECIES_NOUN, joinNames } from "../pets/PetScan";
import { StepImage } from "./StepImage";
import { useStepImages } from "@/lib/images/useStepImages";
import { stepActionFor } from "@/lib/stepAction";
import { flowStep } from "@/lib/stepText";

const fmt = (n: number | null | undefined, digits = 0) =>
  typeof n === "number" ? n.toFixed(digits) : "—";

function nameOf(key: string): string {
  return (CATALOG[key]?.displayName ?? key).toLowerCase();
}

// `id` comes as a prop only from the no-signal screens, where the route has no params.
export function RecipeView({ id: idProp }: { id?: string } = {}) {
  const params = useParams<{ id: string }>();
  const id = idProp ?? params.id;
  const offline = useOffline();
  const [state, setState, hydrated] = useAppState();
  const [servingsOverride, setServingsOverride] = useState<number | null>(null);
  const [eatingIds, setEatingIds] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  usePairingsGate();
  const recipe = hydrated ? (state.plan?.recipes[id] ?? state.favoriteRecipes[id]) : undefined;
  // Step photos are for the person still learning; someone who manages in the kitchen gets the text alone.
  const showStepPhotos = state.profile.skill === "beginner";
  const stepPhotos = useStepImages(recipe, showStepPhotos && Boolean(recipe), setState);

  if (!hydrated) return <div className="min-h-[60vh]" aria-hidden="true" />;

  if (!recipe) {
    return (
      <section className="grid gap-5 py-12 text-center">
        <h1 className="font-display text-[34px] leading-tight">Mama can&apos;t find that recipe.</h1>
        <Link href="/" className={`${btnPrimary} mx-auto`}>
          Back to this week
        </Link>
      </section>
    );
  }

  const plannedMeal = state.plan?.days.flatMap((d) => d.meals).find((m) => m.recipeId === id);
  const servings = plannedMeal ? plannedMeal.servings : (servingsOverride ?? recipe.servings);
  const table = tablePeople(state.people);
  const eating = table.filter((p) => (eatingIds ?? table.map((t) => t.id)).includes(p.id));
  // Plates and notes follow the people picked under the tiles; with nobody picked, the whole household. Servings follow the count.
  const platePeople = eating.length > 0 ? eating : peopleFor(state);
  const changed = servings !== recipe.servings;
  const scaled = scaleRecipe(recipe, servings);
  const nutrition = perServing(scaled, servings);
  const favorite = isFavorite(state, recipe.id);
  const minutes = minutesOf(recipe);
  const costPerServing = mealCostPerServingAvg(recipe, servings);
  const totalCost = proportionalCostUsd(recipe, servings, PRICES);
  const petSpecies = Array.from(new Set(state.pets.map((p) => p.species)));

  // The stepper writes to the planned meal, so Week and Shop follow; a favorite outside the plan keeps a page-local count.
  function setServings(next: number) {
    if (!plannedMeal) {
      setServingsOverride(next);
      return;
    }
    setState((prev) => {
      if (!prev.plan) return prev;
      let done = false;
      const days = prev.plan.days.map((day) => ({
        ...day,
        meals: day.meals.map((meal) => {
          if (done || meal.recipeId !== id) return meal;
          done = true;
          return { ...meal, servings: next };
        }),
      }));
      return { ...prev, plan: { ...prev.plan, days } };
    });
  }

  function pickEating(ids: string[]) {
    setEatingIds(ids);
    setServings(Math.min(8, Math.max(1, ids.length)));
  }
  // A new companion is a household member from now on, as if added in Settings: servings and protein follow.
  function addCompanion(p: Person) {
    setState((prev) => withCompanion(prev, p));
    pickEating([...(eatingIds ?? table.map((t) => t.id)), p.id]);
  }

  return (
    <>
    <Link
      href="/"
      className="mb-4 inline-flex min-h-12 items-center text-[18px] font-semibold text-muted hover:text-ink"
    >
      ← Back to my week
    </Link>
    <article className="grid gap-8 pb-8 lg:grid-cols-[40%_1fr] lg:items-start lg:gap-x-10">
    <div className="contents lg:sticky lg:top-10 lg:grid lg:gap-8 lg:self-start">
      <section className="relative overflow-hidden rounded-[28px] bg-[#231a14] text-white">
        <div className="relative aspect-[4/3] sm:aspect-[21/9] lg:aspect-[4/5]">
          <DishPhoto recipe={recipe} priority sizes="(min-width: 768px) 736px, 100vw" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        </div>
        <HeartButton
          pressed={favorite}
          onToggle={() => setState((prev) => toggleFavorite(prev, recipe))}
          className="absolute right-4 top-4"
        />
        <div className="absolute inset-x-0 bottom-0 grid gap-3 p-6">
          <span className="w-fit rounded-full bg-paper/90 px-3 py-1 text-[15px] font-semibold text-ink">
            {SLOT_LABELS[recipe.slot]}
          </span>
          <h1 className="font-display text-[34px] leading-[1.1] sm:text-[44px]">{recipe.title}</h1>
          {recipe.needsEquipment?.length ? (
            <span
              data-testid="needs-equipment"
              className="w-fit rounded-full bg-[#fde7e2] px-3 py-1 text-[15px] font-semibold text-tomato"
            >
              {needsLine(recipe.needsEquipment) + " · you marked none"}
            </span>
          ) : null}
        </div>
      </section>

      {recipe.source?.videoUrl && (
        <SourceVideo
          videoUrl={recipe.source.videoUrl}
          poster={recipe.source.image}
          url={recipe.source.url}
          platform={recipe.source.platform}
          author={recipe.source.author}
          likes={recipe.source.likes}
        />
      )}
      <BasedOn source={recipe.source} />

      <section
        aria-label="Facts"
        className={`grid gap-3 ${costPerServing === null ? "grid-cols-2" : "grid-cols-3"}`}
      >
        <Fact value={`${fmt(nutrition?.protein_g)} g`} label="protein per serving" />
        <Fact value={`${minutes} min`} label="total time" />
        {costPerServing !== null && (
          <Fact value={formatAvg(costPerServing)} label="cost per serving" />
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-[22px] font-semibold">Servings</h2>
        <Stepper
          label="servings"
          value={servings}
          min={1}
          max={8}
          onChange={setServings}
        />
        {totalCost !== null && (
          <p data-testid="servings-cost" className="text-[16px] text-muted">
            About {formatAvg(totalCost)} for {servings} {servings === 1 ? "serving" : "servings"}
          </p>
        )}
        <WhoIsEating people={table} all={state.people} selected={eating.map((p) => p.id)} onChange={pickEating} onAdd={addCompanion} title="Who's eating?" />
      </section>

      <PlatesCard recipe={recipe} servings={servings} people={platePeople} />

      <div className="order-last sticky bottom-[76px] z-20 rounded-[24px] border border-line bg-paper/95 p-3 shadow-[0_18px_40px_-22px_rgba(35,26,20,0.45)] backdrop-blur lg:static lg:order-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
        <Link
          href={`/cook/${recipe.id}?servings=${servings}`}
          className={`${btnPrimary} w-full`}
        >
          Start cooking
        </Link>
        {offline ? (
          <button type="button" disabled className={`${btnGhost} mt-2 w-full whitespace-nowrap opacity-60`}>
            Pair it · needs signal
          </button>
        ) : (
          <Link href={`/pairings?recipe=${encodeURIComponent(recipe.id)}`} className={`${btnGhost} mt-2 w-full whitespace-nowrap`}>
            Pair it
          </Link>
        )}
      </div>
    </div>
    <div className="contents lg:grid lg:gap-10">
      <section className="grid gap-3">
        <h2 className="text-[22px] font-semibold">Ingredients</h2>
        <ul className="grid gap-1">
          {recipe.ingredients.map((ing, i) => {
            const done = Boolean(checked[i]);
            return (
              <li key={`${ing.key}-${i}`}>
                <label className="flex min-h-12 cursor-pointer items-start gap-4 rounded-2xl p-2">
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [i]: e.target.checked }))}
                    className="mt-1 h-7 w-7 flex-none accent-[var(--color-tomato)]"
                  />
                  <span className={done ? "text-[19px] text-muted line-through" : "text-[19px]"}>
                    {scaled.ingredients[i].display}
                    {changed && scaled.ingredients[i].display === ing.display && (
                      <span className="block text-[16px] text-muted">
                        about {Math.round(scaled.ingredients[i].grams)} g
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {state.profile.mealDrinks && plannedMeal?.drink && (
        <section data-testid="recipe-drink" className="grid gap-3 rounded-[20px] border border-line bg-panel p-5">
          <h2 className="text-[22px] font-semibold">With it: {plannedMeal.drink.name}</h2>
          <p className="text-[18px] leading-snug">{plannedMeal.drink.how}</p>
          <ul className="grid gap-1 text-[18px]">
            {plannedMeal.drink.ingredients.map((ing, i) => (
              <li key={`${ing.key}-${i}`}>{ing.display}</li>
            ))}
          </ul>
          <p className="text-[16px] text-muted">
            {drinkProteinG(plannedMeal.drink, plannedMeal.servings) !== null ? `${drinkProteinG(plannedMeal.drink, plannedMeal.servings)} g protein · ` : ""}about {plannedMeal.drink.sugarG} g sugar per serving
          </p>
        </section>
      )}

      {petSpecies.map((sp) => {
        const petsOfSp = state.pets.filter((p) => p.species === sp);
        return (
          <section key={sp} className="grid gap-3" aria-label={`For your ${SPECIES_NOUN[sp]}`}>
            <h2 className="text-[22px] font-semibold">For {joinNames(petsOfSp.map((p) => p.name))}</h2>
            <ScanRows recipe={recipe} pets={petsOfSp} />
          </section>
        );
      })}

      <section className="grid gap-3">
        <h2 className="text-[22px] font-semibold">Equipment</h2>
        <ul className="flex flex-wrap gap-2">
          {recipe.equipment.map((item) => (
            <li
              key={item}
              className="rounded-full border-2 border-line px-4 py-2 text-[17px] text-ink"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4">
        <h2 className="text-[22px] font-semibold">Steps</h2>
        <ol className="grid gap-5">
          {recipe.steps.map((step, i) => (
            <li key={i} className="grid grid-cols-[2.25rem_1fr] gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-saffron-soft text-[18px] font-semibold">
                {i + 1}
              </span>
              <div className={showStepPhotos ? "grid gap-3 sm:grid-cols-[1fr_220px] sm:items-start" : "grid gap-3"}>
                <p className="text-[19px] leading-relaxed">{flowStep(step.text)}</p>
                {showStepPhotos && (
                  <StepImage action={stepActionFor(step)} imageUrl={step.imageUrl} status={stepPhotos} />
                )}
              </div>
            </li>
          ))}
        </ol>
        {kidNoteFor(recipe, platePeople) && (
          <p data-testid="kid-note" className="font-hand text-[19px] leading-snug text-muted">{kidNoteFor(recipe, platePeople)}</p>
        )}
      </section>

      {recipe.healthierIdeas?.length ? <HealthierIdeas ideas={recipe.healthierIdeas} /> : null}

      {recipe.substitutions.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-[22px] font-semibold">Substitutions</h2>
          <ul className="grid gap-3">
            {recipe.substitutions.map((sub, i) => (
              <li key={i} className="text-[19px] leading-snug">
                No {nameOf(sub.ingredientKey)}? Use {nameOf(sub.swapWith)}.{" "}
                {sub.note && <span className="text-muted">{sub.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="text-[22px] font-semibold">Nutrition per serving</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Nutrient label="kcal" value={fmt(nutrition?.kcal)} />
          <Nutrient label="protein g" value={fmt(nutrition?.protein_g, 1)} />
          <Nutrient label="carbs g" value={fmt(nutrition?.carbs_g, 1)} />
          <Nutrient label="fat g" value={fmt(nutrition?.fat_g, 1)} />
          <Nutrient label="fiber g" value={fmt(nutrition?.fiber_g, 1)} />
        </dl>
        <p className="text-[16px] text-muted">USDA data</p>
      </section>

      {recipe.momTip && <StickyNote signed>{recipe.momTip}</StickyNote>}

    </div>
    </article>
    </>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="grid gap-1 rounded-2xl border border-line bg-panel p-4">
      <p className="font-display text-[26px] leading-none">{value}</p>
      <p className="text-[15px] leading-snug text-muted">{label}</p>
    </div>
  );
}

function Nutrient({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line p-3">
      <dt className="text-[15px] text-muted">{label}</dt>
      <dd className="text-[22px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
