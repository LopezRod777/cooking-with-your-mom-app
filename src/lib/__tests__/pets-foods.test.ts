import { describe, expect, it } from "vitest";
import { PET_FOODS, foodsFor, gramsThatFit, type PetFood } from "../pets/foods";

const chicken: PetFood = {
  id: "test_chicken",
  species: ["dog", "cat"],
  label: "test chicken",
  shortLabel: "Test chicken",
  fdcId: 171477,
  usdaDescription: "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
  kcalPer100g: 165,
  accessedAt: "2026-10-31",
  formWords: ["cooked", "roasted"],
};

describe("gramsThatFit", () => {
  it("600 kcal of chicken (165 kcal/100 g) for dog is capped at 150 g", () => {
    expect(gramsThatFit(chicken, 600, "dog")).toBe(150);
  });

  it("600 kcal for cat is capped at 40 g", () => {
    expect(gramsThatFit(chicken, 600, "cat")).toBe(40);
  });

  it("100 kcal for dog is 60 g (rounded down to 5 g)", () => {
    expect(gramsThatFit(chicken, 100, "dog")).toBe(60);
  });

  it("zero budget gives 0 g", () => {
    expect(gramsThatFit(chicken, 0, "dog")).toBe(0);
  });

  it("negative budget gives 0 g", () => {
    expect(gramsThatFit(chicken, -50, "dog")).toBe(0);
  });
});

describe("PET_FOODS data", () => {
  it("every food has fdcId > 0 and kcalPer100g > 0", () => {
    expect(PET_FOODS.length).toBeGreaterThan(0);
    for (const f of PET_FOODS) {
      expect(f.fdcId, `${f.id} fdcId`).toBeGreaterThan(0);
      expect(f.kcalPer100g, `${f.id} kcalPer100g`).toBeGreaterThan(0);
    }
  });

  it("foodsFor filters by species", () => {
    expect(foodsFor("cat").every((f) => f.species.includes("cat"))).toBe(true);
    expect(foodsFor("dog").length).toBeGreaterThan(foodsFor("cat").length);
  });
});

describe("gramsThatFit daily gram cap", () => {
  const pumpkin: PetFood = { ...chicken, id: "pumpkin_cooked", label: "Pumpkin", shortLabel: "Pumpkin", kcalPer100g: 20 };
  it("subtracts grams already given today from the cap", () => {
    expect(gramsThatFit(pumpkin, 72, "dog")).toBe(150);
    expect(gramsThatFit(pumpkin, 72, "dog", 150)).toBe(0);
    expect(gramsThatFit(pumpkin, 72, "dog", 100)).toBe(50);
  });
});
