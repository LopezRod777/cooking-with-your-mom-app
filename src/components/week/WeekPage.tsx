"use client";

import { mealTimeHint, orderMeals } from "@/lib/mealTimes";
import { planPets } from "@/lib/pets/planPets";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buildGroceryList, dietBreaks, splitBasics, violatesDiet } from "@/lib/grocery";
import { checkinsForRequest, peopleFor, peopleForRequest } from "@/lib/people";
import { dueFor, pendingFor } from "@/lib/checkins";
import { CheckinCard } from "../checkin/CheckinCard";
import { isFavorite, toggleFavorite } from "@/lib/favorites";
import { useOffline } from "@/lib/offline/useOffline";
import { useAppState } from "@/lib/useAppState";
import { useDishImages } from "@/lib/images/useDishImages";
import { useStepImages } from "@/lib/images/useStepImages";
import { DIETS, WeekPlan, type PlannedMeal, type Recipe } from "@/lib/schemas";
import { TrendingStrip } from "../trending/TrendingStrip";
import { SaveOffline } from "../offline/SaveOffline";
import { DishPhoto } from "../ui/DishPhoto";
import { StickyNote } from "../ui/StickyNote";
import { btnGhost, btnPrimary, btnSecondary } from "./classes";
import { MealCard } from "./MealCard";
import { EmptyState, ErrorCard, GeneratingView } from "./PlanStates";
import { AUTOPLAN_KEY } from "./autoplan";
import { SwapSheet } from "./SwapSheet";
import {
  MOM_LINES,
  dayLabels,
  minutesOf,
  otherTitlesFor,
  postJson,
  proteinLabel,
  swapMealRecipe,
  tonightDayIndex,
} from "./plan-utils";

type Status = "idle" | "generating" | "error";

// Pets that can share a plate go with the request; blocked ones (medical restriction) are never sent.

// "Tonight": the dinner of the day that is today (by the plan's real dates), else the plan's first dinner.
function tonightMeal(plan: WeekPlan): { meal: PlannedMeal; recipe: Recipe } | null {
  const today = tonightDayIndex(plan, new Date());
  const todays = plan.days.find((d) => d.dayIndex === today)?.meals.find((m) => m.slot === "dinner");
  const meal = todays ?? plan.days.flatMap((d) => d.meals).find((m) => m.slot === "dinner");
  const recipe = meal ? plan.recipes[meal.recipeId] : undefined;
  return meal && recipe ? { meal, recipe } : null;
}

export function WeekPage() {
  const [state, setState, hydrated] = useAppState();
  useDishImages(state, setState, hydrated);
  // Beginners: tonight's dinner photos start here, while the week is on screen, so the recipe opens with them
  // (same sequential queue and daily cap as opening the recipe; the hook de-duplicates across mounts).
  const tonightRecipe = state.plan ? tonightMeal(state.plan)?.recipe : undefined;
  useStepImages(tonightRecipe, hydrated && state.profile.skill === "beginner" && Boolean(tonightRecipe), setState);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [swapAt, setSwapAt] = useState<{ day: number; meal: number } | null>(null);
  const [lineIdx, setLineIdx] = useState(0);
  const busy = useRef(false);
  const offline = useOffline();

  useEffect(() => {
    if (status !== "generating") return;
    const timer = window.setInterval(() => setLineIdx((i) => (i + 1) % MOM_LINES.length), 4000);
    return () => window.clearInterval(timer);
  }, [status]);

  // Straight from setup: Mama plans the first week herself instead of waiting for "Plan my week".
  const autoplanned = useRef(false);
  useEffect(() => {
    if (!hydrated || offline || autoplanned.current || state.plan || status !== "idle") return;
    let flagged = false;
    try {
      flagged = window.sessionStorage.getItem(AUTOPLAN_KEY) === "1";
      if (flagged) window.sessionStorage.removeItem(AUTOPLAN_KEY);
    } catch {
      flagged = false;
    }
    if (!flagged) return;
    autoplanned.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, offline, state.plan, status]);

  async function generate() {
    if (busy.current || offline) return;
    busy.current = true;
    setConfirming(false);
    setError(null);
    setStatus("generating");
    try {
      const data = (await postJson("/api/plan", {
        profile: state.profile,
        location: state.location,
        pets: planPets(state.pets),
        saved: Object.values(state.favoriteRecipes),
        people: peopleForRequest(peopleFor(state)),
        checkins: checkinsForRequest(state.checkins),
        // First plan of this account: tonight's dinner alone, then the days asked for.
        graceDay: state.firstPlannedAt === null,
      })) as { plan?: unknown } | null;
      const parsed = WeekPlan.safeParse(data?.plan);
      if (!parsed.success) throw new Error("Mama's plan came back a little wrong. Try again.");
      const plan = parsed.data;
      setState((prev) => ({ ...prev, plan, checked: [], firstPlannedAt: prev.firstPlannedAt ?? new Date().toISOString() }));
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }

  function chooseSwap(next: Recipe) {
    if (!swapAt) return;
    const at = swapAt;
    setState((prev) =>
      prev.plan ? { ...prev, plan: swapMealRecipe(prev.plan, at.day, at.meal, next) } : prev,
    );
    setSwapAt(null);
  }

  if (!hydrated) return <div className="min-h-[60vh]" aria-hidden="true" />;
  if (status === "generating") return <GeneratingView line={MOM_LINES[lineIdx]} />;

  const plan = state.plan;
  if (!plan) {
    return <EmptyState profile={state.profile} error={error} onPlan={generate} />;
  }

  const counts = splitBasics(buildGroceryList(plan, { haveAtHome: state.haveAtHome, mealDrinks: state.profile.mealDrinks }));
  const diet = state.profile.diet;
  const dietLabel = (DIETS.find((d) => d.id === diet)?.label ?? "").toLowerCase();
  const breaks = dietBreaks(plan, diet);
  const swapMeal = swapAt ? plan.days[swapAt.day]?.meals[swapAt.meal] : undefined;
  const swapRecipe = swapMeal ? plan.recipes[swapMeal.recipeId] : undefined;
  const tonight = tonightMeal(plan);
  const labels = dayLabels(plan);
  // A check-in waiting for a decision comes first; otherwise the next person who is due.
  const pending = pendingFor(state);
  const due = pending ? state.people.filter((p) => p.id === pending.personId) : dueFor(state);
  const dueIndex = due.length ? state.people.findIndex((p) => p.id === due[0].id) : -1;

  return (
    <div className="grid gap-8 lg:grid-cols-3 lg:items-start lg:gap-x-6 lg:gap-y-10 min-[1440px]:grid-cols-4">
      <h1 className="text-[40px] leading-tight lg:order-[-4] lg:col-span-full">This week</h1>

      {error && (
        <div className="lg:col-span-full">
          <ErrorCard message={error} onRetry={generate} />
        </div>
      )}

      <div className="justify-self-start lg:order-[-3] lg:col-span-full">
        <StickyNote signed>
          {/* The grace day is on top of the days asked for: it is not counted. */}
          {plan.days.filter((d) => !d.grace).length} days planned. {counts.toBuy} {counts.toBuy === 1 ? "thing" : "things"} to buy
          {counts.basics > 0 ? `, plus ${counts.basics} pantry ${counts.basics === 1 ? "basic" : "basics"} you may have.` : "."}
          {diet !== "none" && (
            <>
              {" "}
              {breaks.length === 0
                ? `Every meal checked: ${dietLabel}.`
                : `${breaks.length} ${breaks.length === 1 ? "meal breaks" : "meals break"} ${dietLabel}: swap ${breaks.length === 1 ? "it" : "them"}.`}
            </>
          )}
        </StickyNote>
      </div>

      {dueIndex >= 0 && (
        <div className="lg:col-span-full lg:order-[-2] lg:max-w-[720px]">
          <CheckinCard key={due[0].id} person={due[0]} index={dueIndex} state={state} pending={pending} onSave={(next) => setState(next)} onLater={(next) => setState(next)} />
        </div>
      )}

      {/* Phone: "Plan again" sits up here, smaller than the primary. "Add from a link" lives in Favorites. */}
      <div className="flex flex-wrap gap-2 lg:order-[-3] lg:col-span-full lg:hidden lg:has-[[data-testid$=offline],[data-testid=offline-saved]]:flex">
        <span className="contents lg:hidden">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={offline}
          className="inline-flex min-h-12 items-center rounded-full border-2 border-line px-4 text-[16px] font-semibold disabled:opacity-60"
        >
          {offline ? "Plan again · needs signal" : "Plan again"}
        </button>
        </span>
        <SaveOffline state={state} />
      </div>

      {tonight && (
        <section
          aria-label="Tonight"
          className="hidden overflow-hidden rounded-[28px] border border-line bg-paper lg:order-[-2] lg:col-span-full lg:grid lg:grid-cols-[40%_1fr]"
        >
          <div className="relative min-h-[300px]">
            <DishPhoto recipe={tonight.recipe} priority sizes="40vw" />
          </div>
          <div className="grid content-center gap-4 p-10">
            <p className="text-[15px] font-bold uppercase tracking-[0.12em] text-basil-text">
              Tonight · Dinner
            </p>
            <h2 className="font-display text-[32px] leading-tight">{tonight.recipe.title}</h2>
            <p className="flex flex-wrap gap-x-4 text-[18px]">
              <span className="font-semibold">{proteinLabel(tonight.recipe, tonight.meal.servings)}</span>
              <span className="text-muted">{minutesOf(tonight.recipe)} min</span>
            </p>
            <div className="flex flex-wrap items-center gap-5 pt-2">
              <Link
                href={`/cook/${tonight.recipe.id}?servings=${tonight.meal.servings}`}
                className={btnPrimary}
              >
                Start cooking
              </Link>
              <Link
                href={`/recipe/${tonight.recipe.id}`}
                className="inline-flex min-h-12 items-center text-[17px] font-semibold text-muted underline underline-offset-4 hover:text-ink"
              >
                See recipe
              </Link>
            </div>
          </div>
        </section>
      )}

      {plan.days.map((day, di) => (
        <section
          key={day.dayIndex}
          aria-labelledby={`day-${day.dayIndex}`}
          className="grid content-start gap-4"
        >
          <div className="grid gap-1">
            <h2 id={`day-${day.dayIndex}`} className="font-display text-[32px] leading-tight lg:text-[26px]">
              {day.grace ? "Tonight" : labels[di].weekday}
            </h2>
            <p className="text-[17px] text-muted">{labels[di].date}</p>
            {day.grace && (
              <p data-testid="grace-note" className="font-hand text-[22px] leading-tight text-ink">
                Tonight’s on me, honey, and your {state.profile.daysToPlan} days start tomorrow.
              </p>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
            {orderMeals(day.meals, state.profile.mealTimes).map((mi) => {
              const meal = day.meals[mi];
              const recipe = plan.recipes[meal.recipeId];
              if (!recipe) return null;
              return (
                <MealCard
                  key={`${di}-${mi}`}
                  meal={meal}
                  timeHint={mealTimeHint(meal, state.profile.mealTimes)}
                  recipe={recipe}
                  favorite={isFavorite(state, recipe.id)}
                  breaksDiet={diet !== "none" && violatesDiet(recipe, diet) ? dietLabel : null}
                  showDrink={state.profile.mealDrinks}
                  onToggleFavorite={() => setState((prev) => toggleFavorite(prev, recipe))}
                  onSwap={() => setSwapAt({ day: di, meal: mi })}
                />
              );
            })}
          </div>
        </section>
      ))}

      <div className="sticky bottom-[76px] z-20 rounded-[22px] border border-line bg-paper/95 p-2 shadow-[0_18px_40px_-22px_rgba(35,26,20,0.45)] backdrop-blur lg:static lg:order-[-1] lg:col-span-full lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
        {confirming ? (
          <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
            <p className="text-[18px] font-semibold">Replace this week?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} onClick={generate}>
                Yes, plan again
              </button>
              <button type="button" className={btnGhost} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 lg:justify-end">
            <Link href="/shop" className={`${btnPrimary} min-h-11 w-full text-[17px] lg:min-h-12 lg:w-auto lg:text-[18px]`}>
              Shopping list
            </Link>
            <span className="hidden lg:contents">
              {!offline && (
                <Link href="/import" className={btnSecondary}>
                  Add from a link
                </Link>
              )}
            </span>
            <span className="hidden lg:contents">
              <button type="button" className={`${btnGhost} disabled:opacity-60`} disabled={offline} onClick={() => setConfirming(true)}>
                {offline ? "Plan again · needs signal" : "Plan again"}
              </button>
            </span>
          </div>
        )}
      </div>

      {!offline && <TrendingStrip />}

      {swapAt && swapRecipe && (
        <SwapSheet
          key={`${swapAt.day}-${swapAt.meal}`}
          recipe={swapRecipe}
          otherTitles={otherTitlesFor(plan, swapAt.day, swapAt.meal)}
          profile={state.profile}
          location={state.location}
          pets={state.pets}
          people={peopleFor(state)}
          checkins={state.checkins}
          onChoose={chooseSwap}
          onClose={() => setSwapAt(null)}
        />
      )}
    </div>
  );
}
