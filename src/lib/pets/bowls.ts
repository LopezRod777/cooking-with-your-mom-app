import bowlsJson from "../../../data/pet-bowls.json";
import type { Pet } from "../schemas";
import { PET_FOODS, gramsThatFit, type PetFood } from "./foods";
import { blockedReason, excludedFoodIds } from "./restrictions";
import { dateKey, extrasRemaining, gramsGivenToday, logIsFull } from "./energy";

// Bowls are extras, not a diet. Each bowl lists its foods as % of the bowl's weight (cooked grams).
export type BowlComponent = { foodId: string; pct: number };
// imagePrompt is the photo's subject only (no personal data); the shared photo is cached per bowl id.
export type Bowl = { id: string; name: string; note?: string; components: BowlComponent[]; imagePrompt: string };

const BOWLS = bowlsJson as unknown as Record<"dog" | "cat", Bowl[]>;

export function bowlById(id: string): Bowl | undefined {
  return [...BOWLS.dog, ...BOWLS.cat].find((b) => b.id === id);
}

export type BowlPlan = {
  bowl: Bowl;
  grams: Record<string, number>;
  kcal: number;
  fits: boolean;
  skipped?: "blocked" | "allergen" | "no_budget";
};

export type BowlEntry = {
  id: string;
  date: string;
  kcal: number;
  label: string;
  components: { foodId: string; grams: number; kcal: number }[];
};

const foodById = (id: string): PetFood | undefined => PET_FOODS.find((f) => f.id === id);

// Bowl kcal: the ceiling of the summed kcal of its (already floored) gram amounts. Rounding up once,
// on the total, means a bowl that fits the budget can never be logged above it.
export function ceilKcal(parts: { kcalPer100g: number; grams: number }[]): number {
  return Math.ceil(parts.reduce((sum, p) => sum + p.grams * p.kcalPer100g, 0) / 100);
}

export function bowlsFor(pet: Pet, now: Date): BowlPlan[] {
  if (blockedReason(pet) !== null) return [];
  const today = dateKey(now);
  const remaining = extrasRemaining(pet, now);
  const excluded = excludedFoodIds(pet);

  return BOWLS[pet.species].map((bowl): BowlPlan => {
    if (bowl.components.some((c) => excluded.has(c.foodId))) {
      return { bowl, grams: {}, kcal: 0, fits: false, skipped: "allergen" };
    }
    if (remaining <= 0) {
      return { bowl, grams: {}, kcal: 0, fits: false, skipped: "no_budget" };
    }
    // Total bowl grams that the remaining kcal buys, then each food takes its percentage of the grams.
    const kcalPerGram = bowl.components.reduce((sum, c) => {
      const food = foodById(c.foodId);
      return sum + (food ? (c.pct / 100) * (food.kcalPer100g / 100) : 0);
    }, 0);
    const totalGrams = kcalPerGram > 0 ? remaining / kcalPerGram : 0;
    const grams: Record<string, number> = {};
    const parts: { kcalPer100g: number; grams: number }[] = [];
    for (const c of bowl.components) {
      const food = foodById(c.foodId);
      if (!food) continue;
      // Floored to 5 g and capped by the species per-day gram cap minus what this food already got today.
      // An infinite kcal budget makes gramsThatFit return just that cap.
      const cap = gramsThatFit(food, Infinity, pet.species, gramsGivenToday(pet, c.foodId, today));
      const g = Math.floor(Math.min((totalGrams * c.pct) / 100, cap) / 5) * 5;
      grams[c.foodId] = g;
      parts.push({ kcalPer100g: food.kcalPer100g, grams: g });
    }
    const kcal = ceilKcal(parts);
    const fits = bowl.components.every((c) => (grams[c.foodId] ?? 0) > 0) && kcal <= remaining;
    return { bowl, grams, kcal, fits };
  });
}

// Builds the one log entry for "I fed this", re-checking every rule against the pet as it is now.
// Returns null when the bowl does not fit, is skipped, or the day's log is full.
export function buildBowlEntry(
  pet: Pet,
  bowlId: string,
  now: Date,
  newId: () => string,
): BowlEntry | null {
  const today = dateKey(now);
  if (logIsFull(pet, today)) return null;
  const plan = bowlsFor(pet, now).find((b) => b.bowl.id === bowlId);
  if (!plan || !plan.fits || plan.skipped) return null;
  // Component kcal is shown exact (not rounded); the entry logs the bowl's ceiling, the same number `fits` checked.
  const components = plan.bowl.components.map((c) => {
    const food = foodById(c.foodId)!;
    const grams = plan.grams[c.foodId];
    return { foodId: c.foodId, grams, kcal: (grams * food.kcalPer100g) / 100 };
  });
  return {
    id: newId(),
    date: today,
    kcal: plan.kcal,
    label: plan.bowl.name.slice(0, 60),
    components,
  };
}
