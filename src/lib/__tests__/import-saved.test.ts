import { describe, expect, it } from "vitest";
import { findSavedId, pickId, sameRecipe } from "../import/saved";
import { DEFAULT_STATE, type AppState, type Recipe } from "../schemas";
import { makeRecipe } from "./fixtures";

const withSource = (r: Recipe, url: string): Recipe => ({
  ...r,
  source: { url, platform: "tiktok", title: r.title },
});

function stateWith(over: Partial<AppState>): AppState {
  return { ...DEFAULT_STATE, ...over };
}

describe("pickId", () => {
  const incoming = withSource(makeRecipe({ id: "chicken-bowl", title: "Chicken Bowl" }), "https://www.tiktok.com/@a/video/1");

  it("keeps the slug when nothing is stored under it", () => {
    expect(pickId(incoming, DEFAULT_STATE).id).toBe("chicken-bowl");
  });

  it("suffixes the slug when the id belongs to a different recipe", () => {
    const other = makeRecipe({ id: "chicken-bowl", title: "Chicken Bowl" });
    const state = stateWith({ favorites: ["chicken-bowl"], favoriteRecipes: { "chicken-bowl": other } });
    expect(pickId(incoming, state).id).toBe("chicken-bowl-2");
  });

  it("reuses the id when the same recipe (same title and url) is already stored", () => {
    const state = stateWith({
      favorites: ["chicken-bowl-2"],
      favoriteRecipes: { "chicken-bowl-2": { ...incoming, id: "chicken-bowl-2" } },
    });
    expect(pickId(incoming, state).id).toBe("chicken-bowl-2");
    expect(findSavedId(state, incoming)).toBe("chicken-bowl-2");
  });

  it("treats a plan recipe with the same id but different content as taken", () => {
    const planRecipe = makeRecipe({ id: "chicken-bowl", title: "Other" });
    const state = stateWith({
      plan: { version: 1, createdAt: "2026-10-30T12:00:00.000Z", days: [], recipes: { "chicken-bowl": planRecipe } },
    });
    expect(pickId(incoming, state).id).toBe("chicken-bowl-2");
    expect(sameRecipe(planRecipe, incoming)).toBe(false);
  });
});
