import { CATALOG } from "./catalog";
import type { Recipe } from "./schemas";
import { scaleDisplay } from "./scaleDisplay";

export type Macros = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  // null when any contributing ingredient has no USDA fiber value (4 catalog items).
  fiber_g: number | null;
};

export type NutritionTotals = Macros & { partial?: boolean };

export function recipeNutrition(recipe: Recipe): NutritionTotals | null {
  const totals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  let counted = 0;
  let partial = false;
  let fiberMissing = false;

  for (const ing of recipe.ingredients) {
    const per100g = CATALOG[ing.key]?.per100g;
    if (!per100g) {
      partial = true;
      continue;
    }
    const f = ing.grams / 100;
    totals.kcal += per100g.kcal * f;
    totals.protein_g += per100g.protein_g * f;
    totals.carbs_g += per100g.carbs_g * f;
    totals.fat_g += per100g.fat_g * f;
    if (per100g.fiber_g === null) fiberMissing = true;
    else totals.fiber_g += per100g.fiber_g * f;
    counted += 1;
  }

  if (counted === 0) return null;
  const out: NutritionTotals = { ...totals, fiber_g: fiberMissing ? null : totals.fiber_g };
  if (partial) out.partial = true;
  return out;
}

export function perServing(
  recipe: Recipe,
  servings: number = recipe.servings,
): NutritionTotals | null {
  const totals = recipeNutrition(recipe);
  if (!totals) return null;
  const { partial, ...macros } = totals;
  const out: NutritionTotals = {
    kcal: macros.kcal / servings,
    protein_g: macros.protein_g / servings,
    carbs_g: macros.carbs_g / servings,
    fat_g: macros.fat_g / servings,
    fiber_g: macros.fiber_g === null ? null : macros.fiber_g / servings,
  };
  if (partial) out.partial = true;
  return out;
}

export function scaleRecipe(recipe: Recipe, targetServings: number): Recipe {
  const factor = targetServings / recipe.servings;
  return {
    ...recipe,
    servings: targetServings,
    ingredients: recipe.ingredients.map((ing) => ({
      ...ing,
      grams: Math.round(ing.grams * factor * 100) / 100,
      display: scaleDisplay(ing.display, factor),
    })),
  };
}

// Protein per serving of a meal's drink, from the catalog (grams listed are for `servings`). Null when an
// ingredient has no nutrition entry, so the card says nothing rather than a wrong number.
export function drinkProteinG(drink: { ingredients: { key: string; grams: number }[] }, servings: number): number | null {
  let total = 0;
  for (const ing of drink.ingredients) {
    const per100g = CATALOG[ing.key]?.per100g;
    if (!per100g) return null;
    total += (per100g.protein_g * ing.grams) / 100;
  }
  return Math.round(total / Math.max(1, servings));
}
