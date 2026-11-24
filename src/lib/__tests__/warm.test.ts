import { describe, expect, it, vi } from "vitest";
import type { WeekPlan } from "../schemas";

const calls: { id: string; signal?: AbortSignal }[] = [];
vi.mock("../images/dish", () => ({
  generateDishImage: (recipe: { id: string }, signal?: AbortSignal) => {
    calls.push({ id: recipe.id, signal });
    if (recipe.id === "fast") return Promise.resolve({ url: "https://blob/fast.jpg", cached: true, ms: 1 });
    // Slow ones only settle when aborted, like a Gemini call cut by the signal.
    return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  },
}));

import { warmDishImages } from "../images/warm";

function plan(ids: string[]): WeekPlan {
  const recipes = Object.fromEntries(ids.map((id) => [id, { id, title: id, ingredients: [] }]));
  return {
    days: [{ date: "2026-11-03", meals: ids.map((id, i) => ({ slot: i === 0 ? "dinner" : "lunch", recipeId: id })) }],
    recipes,
  } as unknown as WeekPlan;
}

describe("warmDishImages", () => {
  it("returns at the budget with the photos that landed, and aborts the rest", async () => {
    calls.length = 0;
    const t0 = Date.now();
    const out = await warmDishImages(plan(["slow1", "fast", "slow2"]), { budgetMs: 120, concurrency: 3 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(out.recipes.fast.imageUrl).toBe("https://blob/fast.jpg");
    expect(out.recipes.slow1.imageUrl).toBeUndefined();
    expect(calls.map((c) => c.id).sort()).toEqual(["fast", "slow1", "slow2"]);
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
  });

  it("leaves the plan untouched when every recipe already has a photo", async () => {
    calls.length = 0;
    const p = plan(["a"]);
    p.recipes.a.imageUrl = "https://blob/a.jpg";
    const out = await warmDishImages(p, { budgetMs: 50 });
    expect(out).toBe(p);
    expect(calls.length).toBe(0);
  });
});
