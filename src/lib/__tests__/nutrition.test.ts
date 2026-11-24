import { describe, expect, it } from "vitest";
import { CATALOG } from "../catalog";
import { perServing, recipeNutrition, scaleRecipe } from "../nutrition";
import { makeRecipe } from "./fixtures";
import { Recipe } from "../schemas";

describe("recipeNutrition", () => {
  it("100 g of eggs equals the catalog per100g values exactly", () => {
    const eggs = CATALOG.eggs.per100g!;
    const recipe = {
      ...makeRecipe({ servings: 1 }),
      ingredients: [{ key: "eggs", grams: 100, display: "100 g eggs" }],
    };
    const totals = recipeNutrition(recipe)!;
    expect(totals.kcal).toBe(eggs.kcal);
    expect(totals.protein_g).toBe(eggs.protein_g);
    expect(totals.partial).toBeUndefined();
  });

  it("perServing halves the totals when the recipe makes 2 servings", () => {
    const recipe = {
      ...makeRecipe({ servings: 2 }),
      ingredients: [{ key: "eggs", grams: 100, display: "100 g eggs" }],
    };
    const totals = recipeNutrition(recipe)!;
    const per = perServing(recipe)!;
    expect(per.kcal).toBe(totals.kcal / 2);
    expect(per.protein_g).toBe(totals.protein_g / 2);
  });

  it("sets partial and sums the rest when an ingredient has no per100g data", () => {
    const saved = CATALOG.avocado.per100g;
    CATALOG.avocado.per100g = null;
    try {
      const recipe = {
        ...makeRecipe({ servings: 1 }),
        ingredients: [
          { key: "eggs", grams: 100, display: "100 g eggs" },
          { key: "avocado", grams: 50, display: "half an avocado" },
        ],
      };
      const totals = recipeNutrition(recipe)!;
      expect(totals.partial).toBe(true);
      expect(totals.kcal).toBe(CATALOG.eggs.per100g!.kcal);
    } finally {
      CATALOG.avocado.per100g = saved;
    }
  });

  it("scaleRecipe scales grams, servings and the display text", () => {
    const recipe = makeRecipe({ servings: 2 });
    const scaled = scaleRecipe(recipe, 4);
    expect(scaled.servings).toBe(4);
    expect(scaled.ingredients[0].grams).toBe(200);
    // Fixture ingredient 0 reads "2 eggs": doubled, it reads "4 eggs".
    expect(scaled.ingredients[0].display).toBe("4 eggs");
    expect(Recipe.safeParse(scaled).success).toBe(true);
  });
});
