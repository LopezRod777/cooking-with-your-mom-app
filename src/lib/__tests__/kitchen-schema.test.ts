import { describe, expect, it } from "vitest";
import { AppState, AppStateWire, DEFAULT_KITCHEN, DEFAULT_STATE, Kitchen, Recipe } from "../schemas";
import { rawRecipe } from "./fixtures";

describe("kitchen schema 5", () => {
  it("AppState parses a schema 4 state without kitchen as schema 11 with kitchen null", () => {
    const v4Profile: Record<string, unknown> = { ...DEFAULT_STATE.profile };
    delete v4Profile.kitchen;
    const parsed = AppState.parse({ ...DEFAULT_STATE, schema: 4, profile: v4Profile });
    expect(parsed.schema).toBe(11);
    expect(parsed.profile.kitchen).toBeNull();
  });

  it("AppStateWire rejects a profile without kitchen", () => {
    const profile: Record<string, unknown> = { ...DEFAULT_STATE.profile };
    delete profile.kitchen;
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, profile }).success).toBe(false);
  });

  it("AppStateWire accepts kitchen null and a full Kitchen", () => {
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, profile: { ...DEFAULT_STATE.profile, kitchen: null } }).success).toBe(true);
    const full = { ...DEFAULT_STATE, profile: { ...DEFAULT_STATE.profile, kitchen: { ...DEFAULT_KITCHEN, oven: true } } };
    expect(AppStateWire.safeParse(full).success).toBe(true);
  });

  it("Recipe accepts needsEquipment from KITCHEN_TOOLS and rejects other values", () => {
    expect(Recipe.safeParse(rawRecipe({ needsEquipment: ["oven"] })).success).toBe(true);
    expect(Recipe.safeParse(rawRecipe({ needsEquipment: ["grill"] })).success).toBe(false);
  });

  it("DEFAULT_KITCHEN parses with Kitchen", () => {
    expect(Kitchen.safeParse(DEFAULT_KITCHEN).success).toBe(true);
  });
});
