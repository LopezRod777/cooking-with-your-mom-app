import type { Pet, Recipe } from "../schemas";
import { PET_FOODS, gramsThatFit, type PetFood } from "./foods";
import { ceilKcal, type BowlEntry } from "./bowls";
import { allergenOfKey, blockedReason, excludedFoodIds, shareableForPet } from "./restrictions";
import { dateKey, extrasRemaining, gramsGivenToday, logIsFull } from "./energy";

// "Cook for both": one recipe, one plain portion for the pet. Extras, not the diet.

// Catalog key -> pet food id (ids from data/pet-foods.json). A key not listed here never reaches a pet's portion.
// ground_turkey takes turkey breast: the only turkey in the pet food list.
export const CATALOG_TO_PET_FOOD: Record<string, string> = {
  chicken_breast: "chicken_breast_cooked",
  ground_turkey: "turkey_breast_cooked",
  turkey_breast: "turkey_breast_cooked",
  eggs: "egg_hard_boiled",
  salmon: "salmon_cooked",
  white_rice: "white_rice_cooked",
  sweet_potatoes: "sweet_potato_baked",
  carrots: "carrot_cooked",
  rolled_oats: "oats_cooked",
  oats: "oats_cooked",
};

// At most this many foods in one portion, the heaviest in the recipe first.
const MAX_PORTION_FOODS = 3;

export type PortionPart = { foodId: string; grams: number; kcal: number };
export type PortionPlan = { kcal: number; parts: PortionPart[]; steps: string[] };

const foodById = (id: string): PetFood | undefined => PET_FOODS.find((f) => f.id === id);

// Fixed steps: the pet's piece is set aside before anything that a dog or cat should not get.
export function portionSteps(name: string): string[] {
  return [
    `Set ${name}'s portion aside before salt, oil, onion, garlic or sauce.`,
    "Cook it plain (boil or steam), cool, chop small.",
  ];
}

// The portion for one pet from one recipe, or null when a medical or "other" restriction blocks it,
// when no shareable component maps to a food the pet may have, or when nothing fits what is left today.
// Grams follow the recipe's grams (proportions), scaled to the remaining kcal exactly like bowlsFor.
export function cookForBoth(pet: Pet, recipe: Recipe, now: Date): PortionPlan | null {
  const share = shareableForPet(pet, recipe);
  if (share.vet) return null;
  const today = dateKey(now);
  const remaining = extrasRemaining(pet, now);
  if (remaining <= 0 || logIsFull(pet, today)) return null;
  const excluded = excludedFoodIds(pet);

  const weightByFood = new Map<string, number>();
  for (const key of share.shareable) {
    const foodId = CATALOG_TO_PET_FOOD[key];
    const food = foodId ? foodById(foodId) : undefined;
    if (!food || !food.species.includes(pet.species) || excluded.has(food.id)) continue;
    const grams = recipe.ingredients.filter((i) => i.key === key).reduce((sum, i) => sum + i.grams, 0);
    if (grams <= 0) continue;
    weightByFood.set(food.id, (weightByFood.get(food.id) ?? 0) + grams);
  }
  let candidates = [...weightByFood.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PORTION_FOODS)
    .map(([foodId, weight]) => ({ food: foodById(foodId)!, weight }));

  // A food whose floored grams come out 0 does not fit: drop it and plan the rest again.
  while (candidates.length > 0) {
    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
    const kcalPerGram = candidates.reduce((sum, c) => sum + (c.weight / totalWeight) * (c.food.kcalPer100g / 100), 0);
    const totalGrams = remaining / kcalPerGram;
    const parts = candidates.map((c) => {
      // Floored to 5 g and capped by the species per-day gram cap minus what this food already got today.
      const cap = gramsThatFit(c.food, Infinity, pet.species, gramsGivenToday(pet, c.food.id, today));
      const grams = Math.floor(Math.min((totalGrams * c.weight) / totalWeight, cap) / 5) * 5;
      return { ...c, grams };
    });
    const zero = parts.filter((p) => p.grams <= 0);
    if (zero.length > 0) {
      candidates = candidates.filter((c) => !zero.some((z) => z.food.id === c.food.id));
      continue;
    }
    const kcal = ceilKcal(parts.map((p) => ({ kcalPer100g: p.food.kcalPer100g, grams: p.grams })));
    if (kcal > remaining) return null;
    return {
      kcal,
      parts: parts.map((p) => ({ foodId: p.food.id, grams: p.grams, kcal: (p.grams * p.food.kcalPer100g) / 100 })),
      steps: portionSteps(pet.name),
    };
  }
  return null;
}

// The one log entry for "I fed this", built from the same plan. Null when cookForBoth is null.
export function buildCookForBothEntry(
  pet: Pet,
  recipe: Recipe,
  now: Date,
  newId: () => string,
): BowlEntry | null {
  const plan = cookForBoth(pet, recipe, now);
  if (!plan) return null;
  const suffix = ` · ${pet.name}'s portion`;
  return {
    id: newId(),
    date: dateKey(now),
    kcal: plan.kcal,
    label: recipe.title.slice(0, Math.max(0, 60 - suffix.length)) + suffix,
    components: plan.parts,
  };
}

// Re-checks a cook-for-both entry against the pet as it is in state right now (a second tap, a changed
// restriction, a log that filled up meanwhile). Used by the page handler before it appends the entry.
export function entryStillFits(pet: Pet, entry: BowlEntry, now: Date): boolean {
  const today = dateKey(now);
  if (entry.date !== today || blockedReason(pet) !== null || logIsFull(pet, today)) return false;
  if (entry.kcal > extrasRemaining(pet, now)) return false;
  const excluded = excludedFoodIds(pet);
  const kinds = new Set<string>(pet.restrictions.map((r) => r.kind));
  return entry.components.every((c) => {
    const food = foodById(c.foodId);
    if (!food || !food.species.includes(pet.species) || excluded.has(c.foodId)) return false;
    const keys = Object.entries(CATALOG_TO_PET_FOOD).filter(([, id]) => id === c.foodId).map(([key]) => key);
    if (keys.some((key) => {
      const kind = allergenOfKey(key);
      return kind !== null && kinds.has(kind);
    })) return false;
    const cap = gramsThatFit(food, Infinity, pet.species, gramsGivenToday(pet, c.foodId, today));
    return c.grams > 0 && c.grams <= cap;
  });
}
