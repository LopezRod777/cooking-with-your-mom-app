import { describe, expect, it } from "vitest";
import { CATALOG, packageGrams } from "../catalog";
import { buildGroceryList, planCost, proportionalCostUsd, textMentionsAllergen, violatesAllergies, violatesDiet } from "../grocery";
import { makePlan, makeRecipe } from "./fixtures";

describe("buildGroceryList", () => {
  it("consolidates the same key across meals into one line", () => {
    const plan = makePlan([
      { recipe: makeRecipe({ id: "a", ingredients: [{ key: "onion", grams: 50, display: "50 g onion" }, { key: "eggs", grams: 50, display: "50 g eggs" }] }) },
      { recipe: makeRecipe({ id: "b", ingredients: [{ key: "onion", grams: 50, display: "50 g onion" }, { key: "eggs", grams: 50, display: "50 g eggs" }] }) },
      { recipe: makeRecipe({ id: "c", ingredients: [{ key: "onion", grams: 50, display: "50 g onion" }, { key: "eggs", grams: 50, display: "50 g eggs" }] }) },
    ]);
    const list = buildGroceryList(plan, { haveAtHome: [], mealDrinks: true });
    const onions = list.aisles.flatMap((a) => a.items).filter((i) => i.key === "onion");
    expect(onions).toHaveLength(1);
    expect(onions[0].gramsNeeded).toBe(150);
  });

  it("removes keys already in haveAtHome", () => {
    const plan = makePlan([
      { recipe: makeRecipe({ ingredients: [{ key: "onion", grams: 50, display: "50 g onion" }, { key: "eggs", grams: 50, display: "50 g eggs" }] }) },
    ]);
    const list = buildGroceryList(plan, { haveAtHome: ["onion"], mealDrinks: true });
    const keys = list.aisles.flatMap((a) => a.items).map((i) => i.key);
    expect(keys).toEqual(["eggs"]);
  });

  it("rounds up to whole packages and prices them", () => {
    const plan = makePlan([
      { recipe: makeRecipe({ ingredients: [{ key: "chicken_breast", grams: 700, display: "700 g chicken" }, { key: "eggs", grams: 50, display: "50 g eggs" }] }) },
    ]);
    const pkg = packageGrams(CATALOG.chicken_breast)!;
    expect(Math.ceil(700 / pkg)).toBe(2);
    const list = buildGroceryList(plan, { haveAtHome: [], prices: { chicken_breast: 4.5 }, mealDrinks: true });
    const chicken = list.aisles.flatMap((a) => a.items).find((i) => i.key === "chicken_breast")!;
    expect(chicken.gramsNeeded).toBe(700);
    expect(chicken.packages).toBe(2);
    expect(chicken.estCostUsd).toBe(9);
    // eggs has no price here, so the plan total is the priced items only
    expect(planCost(plan, { chicken_breast: 4.5 }, true).totalUsd).toBe(9);
  });

  it("yields null packages and null cost when packageGrams is unknown", () => {
    expect(CATALOG.cilantro.packageGrams).toBeNull();
    const plan = makePlan([
      { recipe: makeRecipe({ ingredients: [{ key: "cilantro", grams: 100, display: "100 g avocado" }, { key: "eggs", grams: 50, display: "50 g eggs" }] }) },
    ]);
    const list = buildGroceryList(plan, { haveAtHome: [], prices: { avocado: 1.5 }, mealDrinks: true });
    const avocado = list.aisles.flatMap((a) => a.items).find((i) => i.key === "cilantro")!;
    expect(avocado.packages).toBeNull();
    expect(avocado.estCostUsd).toBeNull();
  });

  it("totals priced items as packages × price and counts priced items", () => {
    const ingredients = [
      { key: "chicken_breast", grams: 700, display: "700 g chicken" },
      { key: "white_rice", grams: 200, display: "200 g rice" },
      { key: "broccoli", grams: 300, display: "300 g broccoli" },
    ];
    const plan = makePlan([{ recipe: makeRecipe({ ingredients }) }]);
    const prices: Record<string, number> = { chicken_breast: 5.99, white_rice: 1.29, broccoli: 2.49 };
    const expected = ingredients.reduce(
      (sum, ing) => sum + Math.ceil(ing.grams / packageGrams(CATALOG[ing.key])!) * prices[ing.key],
      0,
    );

    const priced = buildGroceryList(plan, { haveAtHome: [], prices, mealDrinks: true });
    expect(priced.totals.estCostUsd).toBeCloseTo(Math.round(expected * 100) / 100, 2);
    expect(priced.totals.pricedItemCount).toBe(priced.totals.itemCount);
    expect(priced.totals.itemCount).toBe(3);

    const missing = buildGroceryList(plan, {
      haveAtHome: [],
      prices: { chicken_breast: 5.99, broccoli: 2.49 },
      mealDrinks: true,
    });
    const rice = missing.aisles.flatMap((a) => a.items).find((i) => i.key === "white_rice")!;
    expect(rice.estCostUsd).toBeNull();
    expect(missing.totals.pricedItemCount).toBe(priced.totals.pricedItemCount - 1);
  });
});

describe("proportionalCostUsd", () => {
  it("prorates eggs and onion by grams used, below the whole-package cost", () => {
    // makeRecipe defaults: 2 servings, eggs 100 g (package 600 g), onion 50 g (package 110 g).
    const recipe = makeRecipe();
    const prices = { eggs: 2.27, onion: 0.99 };
    const proportional = proportionalCostUsd(recipe, 2, prices)!;
    // Hand computation: (100 / 600) * 2.27 + (50 / 110) * 0.99 = 0.8283...
    expect(proportional).toBeCloseTo((100 / 600) * 2.27 + (50 / 110) * 0.99, 10);
    // Whole packages would be 1 eggs pack + 1 onion: 2.27 + 0.99 = 3.26.
    const plan = makePlan([{ recipe, servings: 2 }]);
    const whole = buildGroceryList(plan, { haveAtHome: [], prices, mealDrinks: true }).totals.estCostUsd!;
    expect(whole).toBe(3.26);
    expect(proportional / 2).toBeLessThan(whole / 2);
  });

  it("returns null when any ingredient has no price", () => {
    expect(proportionalCostUsd(makeRecipe(), 2, { eggs: 2.27 })).toBeNull();
  });
});

describe("textMentionsAllergen", () => {
  it("matches a tag's catalog words in free text, case-insensitive, whole words only", () => {
    expect(textMentionsAllergen("Spread PEANUT BUTTER on toast.", ["peanut"])).toBe(true);
    expect(textMentionsAllergen("Add crushed peanuts.", ["peanut"])).toBe(true);
    expect(textMentionsAllergen("Use a big eggplant.", ["egg"])).toBe(false);
    expect(textMentionsAllergen("Whisk the eggs.", ["egg"])).toBe(true);
  });

  it("matches the tag label words", () => {
    expect(textMentionsAllergen("Use whole wheat for the crust.", ["wheat_gluten"])).toBe(true);
    expect(textMentionsAllergen("Top with cheddar.", ["dairy"])).toBe(true);
  });

  it("does not count a catalog name that is safe for the allergy", () => {
    expect(textMentionsAllergen("Spread peanut butter.", ["dairy"])).toBe(false);
    expect(textMentionsAllergen("Pour in almond milk.", ["dairy"])).toBe(false);
    expect(textMentionsAllergen("Pour in almond milk.", ["tree_nut"])).toBe(true);
  });

  it("matches typed allergies as typed, skipping words under 3 letters", () => {
    expect(textMentionsAllergen("Add a handful of cilantro.", ["cilantro"])).toBe(true);
    expect(textMentionsAllergen("Add a handful of cilantro.", ["sesame"])).toBe(false);
    expect(textMentionsAllergen("Add a handful of cilantro.", [])).toBe(false);
  });
});

describe("violatesDiet", () => {
  const r = (...keys: string[]) => ({ ingredients: keys.map((key) => ({ key })) });

  it("never violates for 'none'", () => {
    expect(violatesDiet(r("pork_loin", "honey"), "none")).toBe(false);
  });

  it("vegetarian: no meat, poultry, fish or shellfish; eggs and dairy are fine", () => {
    expect(violatesDiet(r("chicken_breast", "onion"), "vegetarian")).toBe(true);
    expect(violatesDiet(r("salmon", "onion"), "vegetarian")).toBe(true);
    expect(violatesDiet(r("shrimp", "onion"), "vegetarian")).toBe(true);
    expect(violatesDiet(r("eggs", "cheddar", "onion"), "vegetarian")).toBe(false);
  });

  it("pescatarian: fish is fine, meat and poultry are not", () => {
    expect(violatesDiet(r("salmon", "shrimp"), "pescatarian")).toBe(false);
    expect(violatesDiet(r("ground_turkey", "onion"), "pescatarian")).toBe(true);
  });

  it("vegan: no dairy, egg or honey; soy and tree nut are fine", () => {
    expect(violatesDiet(r("milk", "onion"), "vegan")).toBe(true);
    expect(violatesDiet(r("eggs", "onion"), "vegan")).toBe(true);
    expect(violatesDiet(r("honey", "onion"), "vegan")).toBe(true);
    expect(violatesDiet(r("tofu_firm", "almond_milk"), "vegan")).toBe(false);
  });

  it("kosher: no pork, no shellfish, no meat with dairy in one recipe; fish with dairy is fine", () => {
    expect(violatesDiet(r("pork_loin", "onion"), "kosher")).toBe(true);
    expect(violatesDiet(r("shrimp", "onion"), "kosher")).toBe(true);
    expect(violatesDiet(r("chicken_breast", "cheddar"), "kosher")).toBe(true);
    expect(violatesDiet(r("salmon", "cheddar"), "kosher")).toBe(false);
  });

  it("halal: no pork; chicken is allowed", () => {
    expect(violatesDiet(r("pork_loin", "onion"), "halal")).toBe(true);
    expect(violatesDiet(r("chicken_breast", "onion"), "halal")).toBe(false);
  });

  it("covers the catalog gaps listed by hand (deli turkey, chicken broth, honey)", () => {
    expect(violatesDiet(r("deli_turkey", "onion"), "vegetarian")).toBe(true);
    expect(violatesDiet(r("chicken_broth", "onion"), "vegetarian")).toBe(true);
    expect(violatesDiet(r("honey", "onion"), "vegan")).toBe(true);
  });
});

describe("violatesDiet: carnivore, keto, paleo, mediterranean", () => {
  const r = (...keys: string[]) => ({ ingredients: keys.map((key) => ({ key })) });
  it("carnivore allows animal foods and salt only", () => {
    expect(violatesDiet(r("ground_beef", "eggs", "cheddar", "salt"), "carnivore")).toBe(false);
    expect(violatesDiet(r("salmon", "butter"), "carnivore")).toBe(false);
    expect(violatesDiet(r("ground_beef", "onion"), "carnivore")).toBe(true);
    expect(violatesDiet(r("chicken_breast", "olive_oil"), "carnivore")).toBe(true);
    expect(violatesDiet(r("eggs", "almond_milk"), "carnivore")).toBe(true);
  });

  it("keto bans grains, starches, sugar, legumes and sugary fruit; berries and avocado pass", () => {
    expect(violatesDiet(r("chicken_thigh", "avocado", "blueberries", "olive_oil"), "keto")).toBe(false);
    expect(violatesDiet(r("chicken_thigh", "white_rice"), "keto")).toBe(true);
    expect(violatesDiet(r("eggs", "whole_wheat_bread"), "keto")).toBe(true);
    expect(violatesDiet(r("ground_beef", "black_beans"), "keto")).toBe(true);
    expect(violatesDiet(r("greek_yogurt", "banana"), "keto")).toBe(true);
    expect(violatesDiet(r("rolled_oats", "milk"), "keto")).toBe(true);
  });

  it("paleo bans grains, legumes, dairy, sugar and seed oils", () => {
    expect(violatesDiet(r("salmon", "sweet_potatoes", "spinach", "olive_oil"), "paleo")).toBe(false);
    expect(violatesDiet(r("chicken_breast", "cheddar"), "paleo")).toBe(true);
    expect(violatesDiet(r("tofu_firm", "broccoli"), "paleo")).toBe(true);
    expect(violatesDiet(r("ground_beef", "quinoa"), "paleo")).toBe(true);
    expect(violatesDiet(r("eggs", "peanut_butter"), "paleo")).toBe(true);
  });

  it("mediterranean rejects nothing; the prompt carries the pattern", () => {
    expect(violatesDiet(r("ground_beef", "white_rice", "cheddar"), "mediterranean")).toBe(false);
  });
});

describe("finer sensitivities (nightshade, legume, corn, onion & garlic)", () => {
  it("are hard tags like the FDA nine", () => {
    const salsaBowl = { ingredients: [{ key: "chicken_breast", display: "chicken" }, { key: "salsa", display: "salsa" }] };
    expect(violatesAllergies(salsaBowl, ["nightshade"])).toBe(true);
    expect(violatesAllergies(salsaBowl, ["onion_garlic"])).toBe(true);
    expect(violatesAllergies(salsaBowl, ["legume"])).toBe(false);
    expect(violatesAllergies({ ingredients: [{ key: "peanut_butter" }] }, ["legume"])).toBe(true);
    expect(violatesAllergies({ ingredients: [{ key: "corn_tortillas" }] }, ["corn"])).toBe(true);
    expect(violatesAllergies({ ingredients: [{ key: "sweet_potatoes" }] }, ["nightshade"])).toBe(false);
    expect(textMentionsAllergen("Top with a spoon of salsa.", ["nightshade"])).toBe(true);
  });
});
