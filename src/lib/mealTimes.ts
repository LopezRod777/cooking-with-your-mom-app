import type { MealTimes, PlannedMeal, SnackMoment, SnackTime } from "./schemas";

type MealLike = { slot: PlannedMeal["slot"]; moment?: SnackMoment | null };

// When the day's meals happen. Mama lines the day up around these and places the snack where the person said
// (the owner, 2026-11-03: "snack where it belongs, not always last"). Times are "HH:MM" 24 h.
export const DEFAULT_MEAL_TIMES: MealTimes = { breakfast: "08:00", lunch: "13:00", dinner: "19:30", snack: "mama" };

export const SNACK_TIME_LABELS: Record<SnackTime, string> = {
  mama: "Let Mama pick",
  midmorning: "Mid-morning",
  afternoon: "Afternoon",
  evening: "Evening",
  any: "Whenever I’m hungry",
};

// Minutes since midnight for sorting; the snack sits between its neighbours, "any" after dinner.
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

// "mama" resolves to the moment Mama gave that snack (afternoon until the plan says otherwise).
function effectiveSnack(t: MealTimes, moment?: SnackMoment | null): SnackTime {
  return t.snack === "mama" ? (moment ?? "afternoon") : t.snack;
}

export function snackMinutes(t: MealTimes, moment?: SnackMoment | null): number {
  switch (effectiveSnack(t, moment)) {
    case "midmorning":
      return Math.round((minutes(t.breakfast) + minutes(t.lunch)) / 2);
    case "afternoon":
      return Math.round((minutes(t.lunch) + minutes(t.dinner)) / 2);
    case "evening":
      return minutes(t.dinner) + 90;
    default:
      return minutes(t.dinner) + 91; // listed last, with its own wording
  }
}

export function slotMinutes(meal: MealLike, t: MealTimes): number {
  return meal.slot === "snack" ? snackMinutes(t, meal.moment) : minutes(t[meal.slot]);
}

// Indices of `meals` in the order of the day. Stable for equal times, so storage indices stay usable for swaps.
export function orderMeals(meals: readonly MealLike[], t: MealTimes): number[] {
  return meals
    .map((m, i) => ({ i, at: slotMinutes(m, t) }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map((x) => x.i);
}

// "8 am", "1 pm", "7:30 pm"
export function clockLabel(hhmm: string): string {
  const total = minutes(hhmm);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? "am" : "pm";
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function roundToHalfHour(total: number): string {
  const r = Math.round(total / 30) * 30;
  return `${String(Math.floor(r / 60) % 24).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
}

// What the card says next to the meal label.
export function mealTimeHint(meal: MealLike, t: MealTimes): string {
  if (meal.slot === "snack") {
    if (t.snack === "any") return "whenever you’re hungry";
    return `around ${clockLabel(roundToHalfHour(snackMinutes(t, meal.moment)))}`;
  }
  return `around ${clockLabel(t[meal.slot])}`;
}
