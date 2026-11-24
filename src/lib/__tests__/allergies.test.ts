import { describe, expect, it } from "vitest";
import { violatesAllergies } from "../grocery";
import { allergyLines } from "../ai/prompts";
import { makeRecipe } from "./fixtures";

describe("violatesAllergies", () => {
  const recipe = makeRecipe({
    ingredients: [
      { key: "peanut_butter", grams: 30, display: "2 tbsp peanut butter" },
      { key: "eggs", grams: 50, display: "1 egg" },
    ],
  });

  it("flags a substring match on the ingredient name", () => {
    expect(violatesAllergies(recipe, ["peanut"])).toBe(true);
  });

  it("does not flag an unrelated allergy", () => {
    expect(violatesAllergies(recipe, ["shellfish"])).toBe(false);
  });

  it("flags an exact catalog key", () => {
    expect(violatesAllergies(recipe, ["eggs"])).toBe(true);
  });

  it("flags a peanut tag on peanut_butter", () => {
    expect(violatesAllergies(recipe, ["peanut"])).toBe(true);
  });

  it("does not flag a tag the recipe does not carry", () => {
    expect(violatesAllergies(recipe, ["shellfish", "soy"])).toBe(false);
  });

  it("flags a dairy tag on parmesan", () => {
    const pasta = makeRecipe({
      ingredients: [
        { key: "parmesan", grams: 20, display: "1/4 cup parmesan" },
        { key: "pasta", grams: 100, display: "4 oz pasta" },
      ],
    });
    expect(violatesAllergies(pasta, ["dairy"])).toBe(true);
    expect(violatesAllergies(pasta, ["peanut"])).toBe(false);
  });

  it("matches free text against the ingredient display line", () => {
    const salad = makeRecipe({
      ingredients: [
        { key: "romaine", grams: 80, display: "2 cups cilantro, chopped" },
        { key: "tomatoes", grams: 80, display: "1 roma tomato" },
      ],
    });
    expect(violatesAllergies(salad, ["cilantro"])).toBe(true);
    expect(violatesAllergies(salad, ["romaine"])).toBe(true);
    expect(violatesAllergies(salad, ["peanut"])).toBe(false);
  });

  it("keeps free-text cilantro working on a catalog cilantro item", () => {
    const salsa = makeRecipe({
      ingredients: [
        { key: "cilantro", grams: 10, display: "a handful of herbs" },
        { key: "tomatoes", grams: 80, display: "1 roma tomato" },
      ],
    });
    expect(violatesAllergies(salsa, ["cilantro"])).toBe(true);
  });
});

describe("allergyLines", () => {
  it("lists the catalog keys that carry each tag and keeps free text as typed", () => {
    const [dairy, typed] = allergyLines(["dairy", "sesame oil"]);
    expect(dairy.startsWith("Dairy → ")).toBe(true);
    expect(dairy).toContain("parmesan");
    expect(dairy).not.toContain("peanut_butter");
    expect(typed).toBe("sesame oil (typed, not a tag)");
  });

  it("says none when there are no allergies", () => {
    expect(allergyLines([])).toEqual(["none"]);
  });
});
