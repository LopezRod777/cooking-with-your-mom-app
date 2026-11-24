import { describe, expect, it } from "vitest";
import { formatQty, parseLeadingQty, scaleDisplay } from "../scaleDisplay";
import { scaleRecipe } from "../nutrition";
import { makeRecipe } from "./fixtures";

describe("parseLeadingQty", () => {
  it("parses mixed numbers, fractions, decimals and unicode fractions", () => {
    expect(parseLeadingQty("1 1/2 cups marinara")).toEqual({ qty: 1.5, rest: "cups marinara" });
    expect(parseLeadingQty("3/4 lb chicken breast")).toEqual({ qty: 0.75, rest: "lb chicken breast" });
    expect(parseLeadingQty("½ cup rice")?.qty).toBe(0.5);
  });

  it("returns null without a leading quantity", () => {
    expect(parseLeadingQty("pinch of salt")).toBeNull();
    expect(parseLeadingQty("half an onion")).toBeNull();
  });
});

describe("formatQty", () => {
  it("formats to nearest common fraction, whole, or one decimal", () => {
    expect(formatQty(1.5)).toBe("1 1/2");
    expect(formatQty(0.75)).toBe("3/4");
    expect(formatQty(2)).toBe("2");
    expect(formatQty(0.125)).toBe("1/8");
    expect(formatQty(1.1)).toBe("1.1");
    expect(formatQty(12.4)).toBe("12");
    expect(formatQty(0.3333)).toBe("1/3");
    expect(formatQty(0.6667)).toBe("2/3");
  });
});

describe("scaleDisplay", () => {
  it("scales the leading quantity and fixes the first word's number", () => {
    expect(scaleDisplay("6 large eggs", 0.5)).toBe("3 large eggs");
    expect(scaleDisplay("1/2 cup crumbled feta", 2)).toBe("1 cup crumbled feta");
    expect(scaleDisplay("1 cup rolled oats", 2)).toBe("2 cups rolled oats");
    expect(scaleDisplay("2 cloves garlic, minced", 0.5)).toBe("1 clove garlic, minced");
    expect(scaleDisplay("1 1/2 cups marinara", 1.5)).toBe("2 1/4 cups marinara");
    expect(scaleDisplay("3/4 lb chicken breast", 2)).toBe("1 1/2 lb chicken breast");
    expect(scaleDisplay("1 pinch salt", 2)).toBe("2 pinches salt");
    expect(scaleDisplay("2 limes", 0.5)).toBe("1 lime");
    expect(scaleDisplay("1 Tbsp salt for pasta water", 2)).toBe("2 Tbsp salt for pasta water");
    expect(scaleDisplay("2 flour tortillas (8 in)", 1.5)).toBe("3 flour tortillas (8 in)");
    expect(scaleDisplay("1/4 tsp salt", 0.5)).toBe("1/8 tsp salt");
    expect(scaleDisplay("1 lb ground turkey", 1)).toBe("1 lb ground turkey");
  });

  it("leaves displays without a leading quantity unchanged", () => {
    expect(scaleDisplay("pinch of salt", 2)).toBe("pinch of salt");
    expect(scaleDisplay("half an onion", 2)).toBe("half an onion");
  });
});

describe("scaleRecipe display", () => {
  it("scales grams and display together", () => {
    // Recipe schema requires >= 2 ingredients, so a second one is added; only [0] is asserted.
    const recipe = makeRecipe({
      servings: 2,
      ingredients: [
        { key: "eggs", grams: 100, display: "2 eggs" },
        { key: "onion", grams: 50, display: "half an onion" },
      ],
    });
    const scaled = scaleRecipe(recipe, 4);
    expect(scaled.ingredients[0].grams).toBe(200);
    expect(scaled.ingredients[0].display).toBe("4 eggs");
  });
});
