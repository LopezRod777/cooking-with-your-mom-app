import { describe, expect, it } from "vitest";
import type { Pet } from "../schemas";
import { makeRecipe } from "./fixtures";
import { bowlsFor } from "../pets/bowls";
import { buildCookForBothEntry, cookForBoth, entryStillFits } from "../pets/cookForBoth";

// Same "now" and fixture dog as pets-bowls.test.ts: 12 kg neutered adult, 72 kcal extras budget.
const NOW = new Date(2026, 9, 31, 12);

function pet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "pet_test01",
    name: "Rex",
    species: "dog",
    weightKg: 12,
    bornYearMonth: "2024-05",
    neutered: true,
    expectedAdultSize: "medium",
    restrictions: [],
    extrasLog: [],
    ...overrides,
  };
}

const chickenRiceOnion = () =>
  makeRecipe({
    id: "chicken-rice-skillet",
    title: "Chicken Rice Skillet",
    ingredients: [
      { key: "chicken_breast", grams: 300, display: "300 g chicken breast" },
      { key: "white_rice", grams: 150, display: "150 g white rice" },
      { key: "onion", grams: 80, display: "1 onion, diced" },
      { key: "olive_oil", grams: 10, display: "1 tbsp olive oil" },
      { key: "salt", grams: 2, display: "pinch of salt" },
    ],
  });

describe("cookForBoth", () => {
  it("chicken + rice + onion: only chicken and rice, floors, kcal <= 72, steps say before salt", () => {
    const plan = cookForBoth(pet(), chickenRiceOnion(), NOW)!;
    expect(plan).not.toBeNull();
    expect(plan.parts.map((p) => p.foodId)).toEqual(["chicken_breast_cooked", "white_rice_cooked"]);
    // Recipe weights 300 g chicken : 150 g rice = 2 : 1. 72 kcal buys 46.96 g of portion, so 31.3 g chicken and
    // 15.7 g rice, floored to 5 g: 30 g and 15 g. Kcal: 30 x 1.65 + 15 x 1.30 = 69.
    expect(plan.parts.map((p) => p.grams)).toEqual([30, 15]);
    for (const p of plan.parts) expect(p.grams % 5).toBe(0);
    expect(plan.kcal).toBe(69);
    expect(plan.kcal).toBeLessThanOrEqual(72);
    expect(plan.steps.join(" ")).toContain("before salt");
    expect(plan.steps.join(" ")).toContain("Rex's portion");
  });

  it("the portion never carries onion, oil or salt", () => {
    const plan = cookForBoth(pet(), chickenRiceOnion(), NOW)!;
    expect(plan.parts.some((p) => /onion|oil|salt/.test(p.foodId))).toBe(false);
  });

  it("a medical restriction blocks the portion: null", () => {
    expect(cookForBoth(pet({ restrictions: [{ kind: "kidney" }] }), chickenRiceOnion(), NOW)).toBeNull();
  });

  it("a recipe with no shareable component: null", () => {
    const onionOnly = makeRecipe({
      id: "onion-soup",
      title: "Onion Soup",
      ingredients: [
        { key: "onion", grams: 200, display: "2 onions" },
        { key: "garlic", grams: 5, display: "1 clove garlic" },
        { key: "salt", grams: 2, display: "pinch of salt" },
      ],
    });
    expect(cookForBoth(pet(), onionOnly, NOW)).toBeNull();
  });

  it("an allergen removes that component from the portion", () => {
    const plan = cookForBoth(pet({ restrictions: [{ kind: "chicken" }] }), chickenRiceOnion(), NOW)!;
    expect(plan.parts.map((p) => p.foodId)).toEqual(["white_rice_cooked"]);
  });

  it("no budget left: null", () => {
    const p = pet({ extrasLog: [{ date: "2026-10-31", kcal: 72, label: "used" }] });
    expect(cookForBoth(p, chickenRiceOnion(), NOW)).toBeNull();
  });

  it("proportions follow the recipe grams: 100 g chicken to 300 g rice gives rice the larger share", () => {
    const recipe = makeRecipe({
      id: "rice-heavy",
      title: "Rice Heavy",
      ingredients: [
        { key: "chicken_breast", grams: 100, display: "100 g chicken breast" },
        { key: "white_rice", grams: 300, display: "300 g white rice" },
      ],
    });
    // 1 : 3 by weight. 72 kcal buys 51.89 g of portion: chicken 12.97 g -> 10 g, rice 38.92 g -> 35 g. Kcal 16.5 + 45.5 = 62.
    const plan = cookForBoth(pet(), recipe, NOW)!;
    expect(plan.parts.find((p) => p.foodId === "white_rice_cooked")!.grams).toBeGreaterThan(
      plan.parts.find((p) => p.foodId === "chicken_breast_cooked")!.grams,
    );
    expect(plan.parts.find((p) => p.foodId === "white_rice_cooked")!.grams).toBe(35);
    expect(plan.parts.find((p) => p.foodId === "chicken_breast_cooked")!.grams).toBe(10);
    expect(plan.kcal).toBe(62);
  });

  it("a cat gets only the foods a cat may have (rice is dog-only)", () => {
    const cat = pet({ species: "cat", name: "Luna", weightKg: 4 });
    const plan = cookForBoth(cat, chickenRiceOnion(), NOW)!;
    expect(plan.parts.map((p) => p.foodId)).toEqual(["chicken_breast_cooked"]);
    expect(plan.kcal).toBeLessThanOrEqual(23);
  });
});

describe("buildCookForBothEntry", () => {
  it("builds one atomic entry with the recipe title and the pet's name, components and kcal", () => {
    const e = buildCookForBothEntry(pet(), chickenRiceOnion(), NOW, () => "abc12345")!;
    expect(e.id).toBe("abc12345");
    expect(e.label).toBe("Chicken Rice Skillet · Rex's portion");
    expect(e.components.map((c) => c.foodId)).toEqual(["chicken_breast_cooked", "white_rice_cooked"]);
    expect(e.kcal).toBe(69);
    expect(e.date).toBe("2026-10-31");
  });

  it("the label stays within the 60-character limit for a long title and a long name", () => {
    const longTitle = "A very long recipe title that goes on and on for sixty characters!!";
    const recipe = makeRecipe({ ...chickenRiceOnion(), title: longTitle.slice(0, 60) });
    const e = buildCookForBothEntry(pet({ name: "Maximiliano Alejandro" }), recipe, NOW, () => "x")!;
    expect(e.label.length).toBeLessThanOrEqual(60);
    expect(e.label.endsWith("Maximiliano Alejandro's portion")).toBe(true);
  });

  it("null when the pet is blocked", () => {
    expect(buildCookForBothEntry(pet({ restrictions: [{ kind: "kidney" }] }), chickenRiceOnion(), NOW, () => "x")).toBeNull();
  });
});

describe("entryStillFits", () => {
  it("a fresh entry fits; a second identical one does not fit after the first is logged", () => {
    const p = pet();
    const first = buildCookForBothEntry(p, chickenRiceOnion(), NOW, () => "a")!;
    expect(entryStillFits(p, first, NOW)).toBe(true);
    const afterFirst = pet({ extrasLog: [first] });
    expect(entryStillFits(afterFirst, first, NOW)).toBe(false);
  });

  it("the bowls budget and cook-for-both budget are the same budget", () => {
    // After a cook-for-both entry, the bowls still fit only what is left.
    const first = buildCookForBothEntry(pet(), chickenRiceOnion(), NOW, () => "a")!;
    const after = pet({ extrasLog: [first] });
    for (const b of bowlsFor(after, NOW)) {
      if (b.fits) expect(b.kcal).toBeLessThanOrEqual(72 - first.kcal);
    }
  });
});
