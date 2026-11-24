import type { Pet } from "../schemas";

// Pure energy rules for pets. `now` is always injected; nothing here reads the clock.
// Sources: RER/MER and factors from Merck Veterinary Manual (energy requirements, 70 x kg^0.75).
// The 10 % / 5 % extras caps are OUR conservative rule, not a veterinary figure.

export type Stage = "too_young" | "puppy" | "kitten" | "adult" | "growing_large";

// Age in whole months. Birth counts from the last day of bornYearMonth, so the pet only ages
// into the next month at the start of the month after that: born "2026-09" is 0 months through
// 2026-10-31 and 1 month from 2026-11-01. Never negative.
export function ageMonths(bornYearMonth: string, now: Date): number {
  const [y, m] = bornYearMonth.split("-").map(Number);
  const monthsNow = now.getFullYear() * 12 + now.getMonth();
  const monthsBorn = y * 12 + (m - 1);
  return Math.max(0, monthsNow - monthsBorn - 1);
}

export function stage(pet: Pet, now: Date): Stage {
  const age = ageMonths(pet.bornYearMonth, now);
  if (age < 4) return "too_young";
  if (pet.species === "dog") {
    if (age < 12) return "puppy";
    if (pet.expectedAdultSize === "large" && age < 18) return "growing_large";
    return "adult";
  }
  return age < 12 ? "kitten" : "adult";
}

export type DailyKcal = { rer: number; factor: number | null; mer: number | null; basis: "merck" };

export function dailyKcal(pet: Pet, now: Date): DailyKcal {
  const rer = 70 * pet.weightKg ** 0.75;
  const s = stage(pet, now);
  const factor = factorFor(pet, s);
  return { rer, factor, mer: factor === null ? null : rer * factor, basis: "merck" };
}

function factorFor(pet: Pet, s: Stage): number | null {
  if (s === "too_young") return null;
  if (pet.species === "dog") {
    if (s === "puppy") return 2.0;
    return pet.neutered ? 1.6 : 1.8; // adult and growing_large use the adult factor
  }
  if (s === "kitten") return 2.5;
  return pet.neutered ? 1.2 : 1.4;
}

export type ExtrasBudget = { kcal: number; rule: "10%" | "5%" | "none"; reason: string };

export function extrasBudget(pet: Pet, now: Date): ExtrasBudget {
  const s = stage(pet, now);
  if (s === "too_young") {
    return { kcal: 0, rule: "none", reason: "under 4 months: formulated food only" };
  }
  const { mer } = dailyKcal(pet, now);
  const merKcal = mer ?? 0;
  if (s === "growing_large") {
    return { kcal: Math.floor(merKcal * 0.05), rule: "5%", reason: "growing large dog: our conservative 5 % rule" };
  }
  return { kcal: Math.floor(merKcal * 0.1), rule: "10%", reason: "our conservative 10 % rule" };
}

// Local calendar date as YYYY-MM-DD.
export function dateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function extrasUsedToday(pet: Pet, today: string): number {
  return pet.extrasLog.filter((e) => e.date === today).reduce((sum, e) => sum + e.kcal, 0);
}

// Grams of one food already logged today, so the per-day gram cap holds across taps.
// Counts single-food entries (foodId + grams) and the components of bowl entries.
export function gramsGivenToday(pet: Pet, foodId: string, today: string): number {
  return pet.extrasLog
    .filter((e) => e.date === today)
    .reduce((sum, e) => {
      const single = e.foodId === foodId ? (e.grams ?? 0) : 0;
      const inBowl = (e.components ?? []).reduce((g, c) => (c.foodId === foodId ? g + c.grams : g), 0);
      return sum + single + inBowl;
    }, 0);
}

export function extrasRemaining(pet: Pet, now: Date): number {
  return Math.max(0, extrasBudget(pet, now).kcal - extrasUsedToday(pet, dateKey(now)));
}

// Hard cap on entries per pet, matching the schema's extrasLog max.
export const EXTRAS_LOG_MAX = 60;

// True when today's entries already fill the log, so a new one cannot be recorded.
export function logIsFull(pet: Pet, today: string): boolean {
  return pet.extrasLog.filter((e) => e.date === today).length >= EXTRAS_LOG_MAX;
}

// Keeps entries dated within the last 7 days (today-7 included). Today's entries are never dropped;
// older days are dropped first, most recent kept, so the whole log stays within EXTRAS_LOG_MAX.
export function pruneExtrasLog(pet: Pet, now: Date): Pet {
  const today = dateKey(now);
  const cutoff = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
  const inWindow = pet.extrasLog.filter((e) => e.date >= cutoff);
  const todayCount = inWindow.filter((e) => e.date === today).length;
  const room = Math.max(0, EXTRAS_LOG_MAX - todayCount);
  const olderIdx = inWindow.flatMap((e, i) => (e.date === today ? [] : [i]));
  const keepOlder = new Set(olderIdx.slice(Math.max(0, olderIdx.length - room)));
  return { ...pet, extrasLog: inWindow.filter((e, i) => e.date === today || keepOlder.has(i)) };
}
