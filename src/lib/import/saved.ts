// Pure helpers for putting an imported recipe into favorites or the week without overwriting another recipe.
import type { AppState, Recipe } from "../schemas";

// Same dish from the same post or page. Two imports of one link count as the same recipe.
export function sameRecipe(a: Recipe, b: Recipe): boolean {
  return a.title === b.title && a.source?.url === b.source?.url;
}

export function findSavedId(state: AppState, recipe: Recipe): string | undefined {
  return state.favorites.find((id) => {
    const stored = state.favoriteRecipes[id];
    return stored !== undefined && sameRecipe(stored, recipe);
  });
}

function findPlannedId(state: AppState, recipe: Recipe): string | undefined {
  const recipes = state.plan?.recipes ?? {};
  return Object.keys(recipes).find((id) => sameRecipe(recipes[id], recipe));
}

// Returns the recipe with the id it should be stored under: the id it already has, or the first
// slug not held by a different recipe in favorites or in the plan.
export function pickId(recipe: Recipe, state: AppState): Recipe {
  const existing = findSavedId(state, recipe) ?? findPlannedId(state, recipe);
  if (existing) return { ...recipe, id: existing };
  const planned = state.plan?.recipes ?? {};
  for (let n = 1; ; n++) {
    const id = n === 1 ? recipe.id : `${recipe.id}-${n}`;
    const fav = state.favoriteRecipes[id];
    const inPlan = planned[id];
    const clash =
      (fav !== undefined) ||
      state.favorites.includes(id) ||
      (inPlan !== undefined);
    if (!clash) return { ...recipe, id };
  }
}
