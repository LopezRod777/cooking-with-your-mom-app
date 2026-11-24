import foodsJson from "../../../data/pet-foods.json";
import type { PetSpecies } from "./classify";

export type PetFood = {
  id: string;
  species: PetSpecies[];
  label: string;
  shortLabel: string;
  fdcId: number;
  usdaDescription: string;
  kcalPer100g: number;
  accessedAt: string;
  formWords: string[];
};

export const PET_FOODS: PetFood[] = (foodsJson as unknown as { items: PetFood[] }).items;

export function foodsFor(species: PetSpecies): PetFood[] {
  return PET_FOODS.filter((f) => f.species.includes(species));
}

const DAILY_CAP_G: Record<PetSpecies, number> = { dog: 150, cat: 40 };

// Grams that fit in a kcal budget, rounded down to 5 g, capped per species per day.
// `gramsAlreadyToday` lowers the daily gram cap by what this food already got today.
export function gramsThatFit(
  food: PetFood,
  kcalBudget: number,
  species: PetSpecies,
  gramsAlreadyToday = 0,
): number {
  if (!(kcalBudget > 0) || !(food.kcalPer100g > 0)) return 0;
  const raw = Math.floor(((kcalBudget / food.kcalPer100g) * 100) / 5) * 5;
  const capLeft = Math.max(0, DAILY_CAP_G[species] - gramsAlreadyToday);
  return Math.max(0, Math.min(raw, capLeft));
}
