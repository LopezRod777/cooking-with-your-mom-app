import type { Recipe } from "../schemas";

// Category photo shipped in /public. Used until a dish photo exists.
export function categoryImageFor(recipe: Pick<Recipe, "imageKey">): string {
  return `/media/${recipe.imageKey}.jpg`;
}

// Precedence: generated dish photo > source photo > category photo. Pure, client-safe.
export function publicImageFor(
  recipe: Pick<Recipe, "imageKey" | "imageUrl" | "source">,
): string {
  return recipe.imageUrl ?? recipe.source?.image ?? categoryImageFor(recipe);
}
