import { describe, expect, it } from "vitest";
import { carriedIngredients, stepImageKey, stepIngredients, stepPrompt, stepScene, vesselFor } from "../images/steps";
import { dishComponents } from "../images/dish";
import { CATALOG } from "../catalog";
import { makeRecipe } from "./fixtures";

const base = () =>
  makeRecipe({
    id: "beef-rice-bowl",
    title: "Beef Rice Bowl",
    steps: [{ text: "Boil rice 18 minutes until tender. Drain." }, { text: "Slice beef thin." }, { text: "Serve over rice." }],
  });

describe("stepScene", () => {
  it("is deterministic for the same recipe", () => {
    const r = base();
    expect(stepScene(r)).toEqual(stepScene(r));
  });

  it("varies across recipe ids", () => {
    const surfaces = new Set<string>();
    for (let n = 0; n < 20; n++) {
      surfaces.add(stepScene({ id: `recipe-${n}`, title: "Beef Rice Bowl" }).surface);
    }
    expect(surfaces.size).toBeGreaterThanOrEqual(2);
  });
});

describe("stepPrompt", () => {
  it("applies flowStep and includes the scene surface", () => {
    const r = base();
    const p = stepPrompt(r, 0, false);
    expect(p).toContain("then drain");
    expect(p).toContain(stepScene(r).surface);
  });

  it("opens with the kitchen reference line when a reference is used", () => {
    expect(stepPrompt(base(), 1, true).startsWith("Photo 1 is the kitchen")).toBe(true);
  });
});

describe("stepImageKey", () => {
  it("is stable for the same recipe", () => {
    const r = base();
    expect(stepImageKey(r, 0)).toBe(stepImageKey(base(), 0));
  });

  it("changes key 0 and key 1 when step 0 text changes", () => {
    const r = base();
    const changed = makeRecipe({
      id: "beef-rice-bowl",
      title: "Beef Rice Bowl",
      steps: [{ text: "Boil rice 20 minutes until tender. Drain." }, { text: "Slice beef thin." }, { text: "Serve over rice." }],
    });
    expect(stepImageKey(changed, 0)).not.toBe(stepImageKey(r, 0));
    expect(stepImageKey(changed, 1)).not.toBe(stepImageKey(r, 1));
  });

  it("changes key 1 but not key 0 when step 1 text changes", () => {
    const r = base();
    const changed = makeRecipe({
      id: "beef-rice-bowl",
      title: "Beef Rice Bowl",
      steps: [{ text: "Boil rice 18 minutes until tender. Drain." }, { text: "Dice beef small." }, { text: "Serve over rice." }],
    });
    expect(stepImageKey(changed, 1)).not.toBe(stepImageKey(r, 1));
    expect(stepImageKey(changed, 0)).toBe(stepImageKey(r, 0));
  });

  it("changes key 2 but not key 0 when step 1 text changes", () => {
    const r = base();
    const changed = makeRecipe({
      id: "beef-rice-bowl",
      title: "Beef Rice Bowl",
      steps: [{ text: "Boil rice 18 minutes until tender. Drain." }, { text: "Dice beef small." }, { text: "Serve over rice." }],
    });
    expect(stepImageKey(changed, 2)).not.toBe(stepImageKey(r, 2));
    expect(stepImageKey(changed, 0)).toBe(stepImageKey(r, 0));
  });

  it("does not change when ingredients are reordered", () => {
    const r = makeRecipe({
      id: "beef-rice-bowl",
      title: "Beef Rice Bowl",
      ingredients: [
        { key: "ground_beef", grams: 300, display: "300 g ground beef" },
        { key: "white_rice", grams: 200, display: "200 g white rice" },
      ],
      steps: base().steps,
    });
    const reordered = makeRecipe({
      id: "beef-rice-bowl",
      title: "Beef Rice Bowl",
      ingredients: [
        { key: "white_rice", grams: 200, display: "200 g white rice" },
        { key: "ground_beef", grams: 300, display: "300 g ground beef" },
      ],
      steps: base().steps,
    });
    expect(stepImageKey(reordered, 0)).toBe(stepImageKey(r, 0));
  });
});

describe("stepIngredients and per-step prompt", () => {
  const omelet = () =>
    makeRecipe({
      id: "spinach-feta-egg-toast",
      title: "Spinach Feta Egg Toast",
      ingredients: [
        { key: "eggs", grams: 120, display: "3 eggs" },
        { key: "spinach", grams: 60, display: "2 cups baby spinach" },
        { key: "feta", grams: 40, display: "40 g feta" },
        { key: "whole_wheat_bread", grams: 60, display: "2 slices whole wheat bread" },
      ],
      steps: [
        { text: "Whisk eggs, egg whites, salt and pepper in a bowl until no streaks remain." },
        { text: "Heat oil in a nonstick skillet over medium. Add spinach and stir until wilted, about 1 minute." },
        { text: "Pull the pan off heat. Stir in feta; they finish setting from leftover heat." },
        { text: "Toast the bread and serve the eggs on top or alongside." },
        { text: "Let it rest 5 minutes." },
      ],
    });

  it("uses the catalog keys this test relies on", () => {
    for (const k of ["eggs", "spinach", "feta", "whole_wheat_bread"]) expect(CATALOG[k]).toBeDefined();
  });

  it("names the eggs in step 0 and not feta", () => {
    const s = stepIngredients(omelet(), 0);
    expect(s.some((x) => x.includes("egg"))).toBe(true);
    expect(s.some((x) => x.includes("feta"))).toBe(false);
  });

  it("names spinach in step 1 and not feta", () => {
    const s = stepIngredients(omelet(), 1);
    expect(s.some((x) => x.includes("spinach"))).toBe(true);
    expect(s.some((x) => x.includes("feta"))).toBe(false);
  });

  it("names feta in step 2", () => {
    expect(stepIngredients(omelet(), 2).some((x) => x.includes("feta"))).toBe(true);
  });

  it("names bread and eggs in step 3", () => {
    const s = stepIngredients(omelet(), 3);
    expect(s.some((x) => x.includes("bread"))).toBe(true);
    expect(s.some((x) => x.includes("egg"))).toBe(true);
  });

  it("falls back to the dish components when the step names no food", () => {
    const r = omelet();
    expect(stepIngredients(r, 4)).toEqual(dishComponents(r).slice(0, 3));
  });

  it("tells the model only the step's food is in frame and the vessel stays empty", () => {
    const p = stepPrompt(omelet(), 1, true);
    expect(p).toContain("Only the food this step names");
    expect(p).toContain("stays empty to one side");
  });

  it("resolves the vessel from the step, or the last earlier step that named one", () => {
    const r = omelet();
    expect(vesselFor(r, 0)).toBe("bowl");
    expect(vesselFor(r, 1)).toBe("nonstick skillet");
    expect(vesselFor(r, 2)).toBe("nonstick skillet");
    expect(vesselFor(r, 3)).toBe("nonstick skillet");
  });

  it("carries spinach from step 1 into step 2, which does not name it", () => {
    const carried = carriedIngredients(omelet(), 2);
    expect(carried).toContain("baby spinach");
    expect(carried).not.toContain("feta");
  });

  it("carries nothing into step 0", () => {
    expect(carriedIngredients(omelet(), 0)).toEqual([]);
  });

  it("does not carry step 0's bowl contents into step 1's skillet", () => {
    expect(carriedIngredients(omelet(), 1)).not.toContain("eggs");
  });

  it("says the plate step is served on a plate, not in the cookware", () => {
    expect(stepPrompt(omelet(), 3, true)).toContain("Served on a plate");
  });

  it("gives step 2 the two-photo reference wording and the carry-forward text", () => {
    const p = stepPrompt(omelet(), 2, true);
    expect(p).toContain("Photo 2 is the previous step");
    expect(p).toContain("Already there from earlier steps");
    expect(p).toContain("baby spinach");
  });
});
