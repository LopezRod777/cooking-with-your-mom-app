import { proportionalCostUsd } from "../../lib/grocery";
import { PRICES } from "../../lib/prices";
import { perServing } from "../../lib/nutrition";
import type { PlannedMeal, Recipe, WeekPlan } from "../../lib/schemas";

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const SLOT_LABELS: Record<PlannedMeal["slot"], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

// Shown when a meal has no fully priced ingredient list.
export const COST_PER_SERVING_LABEL = "$ — / serving";

export const MOM_LINES = [
  "Picking your meals…",
  "Writing the recipes…",
  "Checking protein and time…",
  "Almost there…",
];

export function dayName(dayIndex: number): string {
  return DAY_NAMES[dayIndex] ?? `Day ${dayIndex + 1}`;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type DayLabel = {
  dayIndex: number;
  weekday: string;
  date: string;
  day: Date; // local midnight of that calendar day
};

// Local midnight of the calendar day an ISO instant falls on, in the browser's time zone.
function localMidnight(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Day 0 is the calendar day of plan.createdAt; dayIndex d is d days after it.
// Returns one label per entry of plan.days, in the same order.
export function dayLabels(plan: Pick<WeekPlan, "createdAt" | "days">): DayLabel[] {
  const anchor = localMidnight(plan.createdAt);
  return plan.days.map((day) => {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + day.dayIndex);
    return {
      dayIndex: day.dayIndex,
      weekday: WEEKDAY_NAMES[d.getDay()],
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      day: d,
    };
  });
}

// The dayIndex whose calendar day is `now`'s day; the first planned day when the plan does not cover today.
export function tonightDayIndex(plan: Pick<WeekPlan, "createdAt" | "days">, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hit = dayLabels(plan).find((l) => l.day.getTime() === today);
  return hit ? hit.dayIndex : (plan.days[0]?.dayIndex ?? 0);
}

export function proteinLabel(recipe: Recipe, servings: number): string {
  const p = perServing(recipe, servings);
  return p ? `${Math.round(p.protein_g)} g protein` : "— g protein";
}

// Per-serving cost of one meal at `servings`, from the national averages. Null unless every
// ingredient of the meal is priced, so a partial list never reads as a full cost.
export function mealCostPerServingAvg(recipe: Recipe, servings: number): number | null {
  if (servings < 1) return null;
  const total = proportionalCostUsd(recipe, servings, PRICES);
  if (total === null) return null;
  return Math.round((total / servings) * 100) / 100;
}

export function minutesOf(recipe: Recipe): number {
  return recipe.prepMinutes + recipe.cookMinutes;
}

// Titles of every planned meal except the one at (dayIdx, mealIdx).
export function otherTitlesFor(plan: WeekPlan, dayIdx: number, mealIdx: number): string[] {
  const titles: string[] = [];
  plan.days.forEach((day, di) =>
    day.meals.forEach((meal, mi) => {
      if (di === dayIdx && mi === mealIdx) return;
      const title = plan.recipes[meal.recipeId]?.title;
      if (title) titles.push(title);
    }),
  );
  return titles;
}

// Puts `next` in the meal's slot. The old recipe leaves the record only when no other meal uses it.
export function swapMealRecipe(
  plan: WeekPlan,
  dayIdx: number,
  mealIdx: number,
  next: Recipe,
): WeekPlan {
  const oldId = plan.days[dayIdx]?.meals[mealIdx]?.recipeId;
  if (!oldId) return plan;

  const days = plan.days.map((day, di) =>
    di !== dayIdx
      ? day
      : {
          ...day,
          meals: day.meals.map((meal, mi) =>
            mi !== mealIdx ? meal : { ...meal, recipeId: next.id },
          ),
        },
  );

  const stillUsed = days.some((day) => day.meals.some((meal) => meal.recipeId === oldId));
  const recipes: Record<string, Recipe> = { ...plan.recipes };
  if (!stillUsed && oldId !== next.id) delete recipes[oldId];
  recipes[next.id] = next;

  return { ...plan, days, recipes };
}

export async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new Error("Check your connection and try again.");
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Something went wrong.";
    throw new Error(message === "other_account" ? "Someone else signed in on this device. Reload the page." : message);
  }
  return data;
}
