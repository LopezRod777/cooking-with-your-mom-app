import { describe, expect, it } from "vitest";
import { AppStateWire, DEFAULT_STATE, Drink, PlannedMeal, Profile } from "../schemas";
import { assemblePlan, drinksRule, toDrink } from "../ai/plan";
import type { LlmRecipe, LlmSkeleton } from "../ai/llmSchemas";
import { buildGroceryList } from "../grocery";
import { listKeys } from "../cart";
import { drinkProteinG } from "../nutrition";
import { makePlan, makeRecipe } from "./fixtures";

const smoothie = {
  name: "Banana peanut smoothie",
  kind: "smoothie" as const,
  ingredients: [
    { key: "banana", grams: 240, display: "2 bananas" },
    { key: "peanut_butter", grams: 32, display: "2 tbsp peanut butter" },
    { key: "milk", grams: 480, display: "2 cups milk" },
  ],
  sugarG: 14,
  how: "Blend everything with a handful of ice until smooth.",
};

describe("drinks with a meal", () => {
  it("a planned meal defaults to water (drink null) and accepts a strict drink", () => {
    expect(PlannedMeal.parse({ slot: "lunch", recipeId: "x", servings: 2 }).drink).toBeNull();
    expect(Drink.safeParse(smoothie).success).toBe(true);
    expect(Drink.safeParse({ ...smoothie, ingredients: [] }).success).toBe(false);
    expect(Drink.safeParse({ ...smoothie, kind: "beer" }).success).toBe(false);
  });

  it("toDrink keeps a clean drink, turns a bad or allergenic one into water", () => {
    expect(toDrink(smoothie, [])?.name).toBe("Banana peanut smoothie");
    expect(toDrink(smoothie, ["peanut"])).toBeNull(); // peanut_butter carries the peanut tag
    expect(toDrink({ ...smoothie, ingredients: [{ key: "not_a_key", grams: 10, display: "?" }] }, [])).toBeNull();
    expect(toDrink({ ...smoothie, sugarG: 7.6 }, [])?.sugarG).toBe(8);
    expect(toDrink(null, [])).toBeNull();
    expect(toDrink(undefined, [])).toBeNull();
  });

  it("the shopping list carries the drink's ingredients and the card gets catalog protein", () => {
    const recipe = makeRecipe({ id: "egg-wrap", ingredients: [{ key: "eggs", grams: 100, display: "2 eggs" }, { key: "spinach", grams: 30, display: "a handful of spinach" }] });
    const plan = makePlan([{ recipe, drink: smoothie }]);
    const list = buildGroceryList(plan, { haveAtHome: [], mealDrinks: true });
    const keys = list.aisles.flatMap((a) => a.items.map((i) => i.key));
    expect(keys).toEqual(expect.arrayContaining(["eggs", "banana", "peanut_butter", "milk"]));
    expect(list.aisles.flatMap((a) => a.items).find((i) => i.key === "banana")?.gramsNeeded).toBe(240);
    // 240 g banana (1.09/100) + 32 g peanut butter (22.21/100) + 480 g milk (3.3/100) ≈ 25.5 g for 2 servings → 13 each
    expect(drinkProteinG(smoothie, 2)).toBe(13);
    expect(drinkProteinG({ ingredients: [{ key: "nope", grams: 10 }] }, 1)).toBeNull();
  });
});

const llmRecipe = (overrides: Partial<LlmRecipe> = {}): LlmRecipe => ({
  id: "ignored-by-assembly",
  title: "Egg Wrap",
  cuisine: "American",
  slot: "breakfast",
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 5,
  ingredients: [{ key: "eggs", grams: 100, display: "2 eggs" }, { key: "spinach", grams: 30, display: "a handful of spinach" }],
  equipment: ["skillet"],
  steps: [{ text: "Cook the eggs.", action: "sear" as const }, { text: "Serve.", action: "plate" as const }],
  substitutions: [],
  momTip: undefined,
  imageKey: "hero",
  ...overrides,
});

describe("meal drinks off by default (profile.mealDrinks)", () => {
  it("with mealDrinks false the list has no drink ingredients, and keeps the meal's own", () => {
    const recipe = makeRecipe({ id: "egg-wrap", ingredients: [{ key: "eggs", grams: 100, display: "2 eggs" }, { key: "spinach", grams: 30, display: "a handful of spinach" }] });
    const plan = makePlan([{ recipe, drink: smoothie }]);
    const keys = buildGroceryList(plan, { haveAtHome: [], mealDrinks: false }).aisles.flatMap((a) => a.items.map((i) => i.key));
    expect([...keys].sort()).toEqual(["eggs", "spinach"]);
  });

  it("with mealDrinks false a banana that is also a recipe ingredient counts only the recipe grams", () => {
    const recipe = makeRecipe({ id: "banana-bread", ingredients: [{ key: "banana", grams: 50, display: "1 banana" }, { key: "eggs", grams: 100, display: "2 eggs" }] });
    const plan = makePlan([{ recipe, drink: smoothie }]);
    const off = buildGroceryList(plan, { haveAtHome: [], mealDrinks: false }).aisles.flatMap((a) => a.items).find((i) => i.key === "banana");
    const on = buildGroceryList(plan, { haveAtHome: [], mealDrinks: true }).aisles.flatMap((a) => a.items).find((i) => i.key === "banana");
    expect(off?.gramsNeeded).toBe(50);
    expect(on?.gramsNeeded).toBe(290);
  });

  it("listKeys with mealDrinks false leaves out the drink's keys", () => {
    const recipe = makeRecipe({ id: "egg-wrap", ingredients: [{ key: "eggs", grams: 100, display: "2 eggs" }, { key: "spinach", grams: 30, display: "a handful of spinach" }] });
    const plan = makePlan([{ recipe, drink: smoothie }]);
    expect(listKeys(plan, [], false).sort()).toEqual(["eggs", "spinach"]);
    expect(listKeys(plan, [], true)).toEqual(expect.arrayContaining(["banana", "peanut_butter", "milk"]));
  });

  it("assemblePlan sets drink to null by default, and keeps the skeleton's drink only with mealDrinks true", () => {
    const skeleton = {
      days: [{ dayIndex: 0, label: "Day 1", meals: [{ slot: "breakfast", title: "Egg Wrap", cuisine: "American", mainProtein: "eggs", servings: 2, drink: smoothie }] }],
    } as unknown as LlmSkeleton;
    const dayRecipes: LlmRecipe[][] = [[llmRecipe()]];
    const created = "2026-10-30T12:00:00.000Z";
    expect(assemblePlan(skeleton, dayRecipes, [], created).days[0].meals[0].drink).toBeNull();
    expect(assemblePlan(skeleton, dayRecipes, [], created, false, false).days[0].meals[0].drink).toBeNull();
    expect(assemblePlan(skeleton, dayRecipes, [], created, false, true).days[0].meals[0].drink?.name).toBe("Banana peanut smoothie");
  });

  it("drinksRule off is the one-line null rule; on keeps the drink guidance", () => {
    expect(drinksRule({ mealDrinks: false, servingsPerMeal: 2 })).toBe("\n\nDrinks: set drink to null on every meal.");
    expect(drinksRule({ mealDrinks: true, servingsPerMeal: 2 })).toContain("For 3 to 5 meals");
  });

  it("a profile without the flag reads it as false", () => {
    expect(Profile.parse({ version: 1 }).mealDrinks).toBe(false);
  });

  it("the PUT wire rejects a schema 10 body and a schema 11 body without profile.mealDrinks", () => {
    const { mealDrinks: _unused, ...rest } = DEFAULT_STATE.profile;
    void _unused;
    const noFlag = { ...DEFAULT_STATE, profile: { ...rest, mealDrinks: undefined } };
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 10 }).success).toBe(false);
    expect(AppStateWire.safeParse(noFlag).success).toBe(false);
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, profile: { ...DEFAULT_STATE.profile, mealDrinks: true } }).success).toBe(true);
  });
});
