import type { AppState, Recipe } from "./schemas";

export function isFavorite(state: AppState, recipeId: string): boolean {
  return state.favorites.includes(recipeId);
}

// Pure: returns a new state with the recipe added to or removed from favorites.
export function toggleFavorite(state: AppState, recipe: Recipe): AppState {
  if (isFavorite(state, recipe.id)) {
    const { [recipe.id]: _removed, ...rest } = state.favoriteRecipes;
    return { ...state, favorites: state.favorites.filter((id) => id !== recipe.id), favoriteRecipes: rest };
  }
  return {
    ...state,
    favorites: [...state.favorites, recipe.id],
    favoriteRecipes: { ...state.favoriteRecipes, [recipe.id]: recipe },
  };
}
