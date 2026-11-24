import type { Drink } from "../schemas";
import { Recipe, type Recipe as RecipeT, type WeekPlan } from "../schemas";

type RawRecipe = Record<string, unknown>;

export function rawRecipe(overrides: RawRecipe = {}): RawRecipe {
  return {
    id: "test-recipe",
    title: "Test recipe",
    cuisine: "American",
    slot: "dinner",
    servings: 2,
    prepMinutes: 10,
    cookMinutes: 10,
    ingredients: [
      { key: "eggs", grams: 100, display: "2 eggs" },
      { key: "onion", grams: 50, display: "half an onion" },
    ],
    equipment: ["skillet"],
    steps: [{ text: "Cook it." }, { text: "Eat it." }],
    substitutions: [],
    imageKey: "hero",
    ...overrides,
  };
}

export function makeRecipe(overrides: RawRecipe = {}): RecipeT {
  return Recipe.parse(rawRecipe(overrides));
}

export function makePlan(meals: { recipe: RecipeT; servings?: number; drink?: Drink | null }[]): WeekPlan {
  const recipes: Record<string, RecipeT> = {};
  for (const m of meals) recipes[m.recipe.id] = m.recipe;
  return {
    version: 1,
    createdAt: "2026-10-30T12:00:00.000Z",
    days: [
      {
        dayIndex: 0,
        label: "Monday",
        grace: false,
        meals: meals.map((m) => ({
          slot: m.recipe.slot,
          recipeId: m.recipe.id,
          servings: m.servings ?? m.recipe.servings,
          drink: m.drink ?? null,
          moment: null,
        })),
      },
    ],
    recipes,
  };
}
