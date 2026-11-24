import { describe, expect, it } from "vitest";
import { assemblePlan } from "../ai/plan";
import type { LlmRecipe } from "../ai/llmSchemas";
import { matchSaved, SAVED_MAX, savedForPlan, savedText } from "../ai/saved";
import { Profile } from "../schemas";
import { makeRecipe } from "./fixtures";

const profile = Profile.parse({ version: 1, maxMinutesPerMeal: 30 });
const imported = makeRecipe({
  id: "abuela-arroz-con-pollo",
  title: "Abuela's Arroz con Pollo",
  source: { url: "https://www.tiktok.com/@abuela/video/1", platform: "tiktok", author: "abuela" },
  imageUrl: "https://example.com/arroz.jpg",
});

describe("savedForPlan", () => {
  it("drops disabled slots, allergy and diet breaks, long recipes and duplicate titles; imported first; capped", () => {
    const list = [
      makeRecipe({ id: "a", title: "Plain" }),
      imported,
      makeRecipe({ id: "snack", title: "Snack", slot: "snack" }),
      makeRecipe({ id: "slow", title: "Slow", prepMinutes: 30, cookMinutes: 30 }),
      makeRecipe({ id: "dup", title: "plain " }),
      makeRecipe({ id: "shrimp", title: "Shrimp", ingredients: [{ key: "shrimp", grams: 200, display: "shrimp" }, { key: "white_rice", grams: 100, display: "rice" }] }),
    ];
    // Eggs are fine for a vegetarian; the same list under a vegan diet drops them all.
    const vegan = savedForPlan(list, Profile.parse({ version: 1, maxMinutesPerMeal: 30, allergies: ["shellfish"], diet: "vegan" }));
    expect(vegan.map((r) => r.id)).toEqual([]);
    const out2 = savedForPlan(list, Profile.parse({ version: 1, maxMinutesPerMeal: 30, allergies: ["shellfish"] }));
    expect(out2.map((r) => r.id)).toEqual(["abuela-arroz-con-pollo", "a"]);
    const many = Array.from({ length: 20 }, (_, i) => makeRecipe({ id: `r${i}`, title: `Recipe ${i}` }));
    expect(savedForPlan(many, profile)).toHaveLength(SAVED_MAX);
  });
});

describe("savedText", () => {
  it("is empty without recipes and lists exact titles with slot, minutes and origin", () => {
    expect(savedText([], 5)).toBe("");
    const text = savedText([imported], 5);
    expect(text).toContain('"Abuela\'s Arroz con Pollo" (dinner, 20 min');
    expect(text).toContain("saved from TikTok");
    expect(text).toContain("use up to 1 of them");
  });
});

describe("a saved recipe inside the plan", () => {
  it("matches by title and slot, and assembles with its source and image kept", () => {
    expect(matchSaved([imported], "abuela's arroz con pollo", "dinner")?.id).toBe(imported.id);
    expect(matchSaved([imported], "Abuela's Arroz con Pollo", "lunch")).toBeUndefined();
    const skeleton = {
      days: [{ dayIndex: 0, label: "Day 1", meals: [{ slot: "dinner" as const, title: imported.title, cuisine: "Latin", mainProtein: "chicken", servings: imported.servings }] }],
    };
    const plan = assemblePlan(skeleton, [[imported as unknown as LlmRecipe]]);
    const recipe = Object.values(plan.recipes)[0];
    expect(recipe.source?.platform).toBe("tiktok");
    expect(recipe.imageUrl).toBe("https://example.com/arroz.jpg");
    expect(recipe.title).toBe(imported.title);
  });
});
