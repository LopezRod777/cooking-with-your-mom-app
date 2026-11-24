import { describe, expect, it } from "vitest";
import type { Kitchen } from "../schemas";
import { missingEquipment, needsLine } from "../ai/kitchen";

const ALL: Kitchen = {
  stove: true,
  oven: true,
  microwave: true,
  airFryer: true,
  blender: true,
  toaster: true,
  riceCooker: true,
  multiCooker: true,
};
const NO_OVEN: Kitchen = { ...ALL, oven: false };
const MIN: Kitchen = {
  stove: true,
  oven: false,
  microwave: true,
  airFryer: false,
  blender: false,
  toaster: false,
  riceCooker: false,
  multiCooker: false,
};

describe("missingEquipment", () => {
  it("oven recipe needs an oven", () => {
    const recipe = { equipment: ["baking sheet"], steps: [{ text: "Bake at 400°F for 20 min" }] };
    expect(missingEquipment(recipe, NO_OVEN)).toEqual(["oven"]);
    expect(missingEquipment(recipe, ALL)).toEqual([]);
  });

  it("step action 'bake' counts as oven", () => {
    const recipe = { equipment: [], steps: [{ text: "Cook until golden", action: "bake" }] };
    expect(missingEquipment(recipe, NO_OVEN)).toEqual(["oven"]);
  });

  it("stovetop recipe", () => {
    const recipe = {
      equipment: ["large skillet"],
      steps: [{ text: "Sear the chicken" }, { text: "Simmer 10 min" }],
    };
    expect(missingEquipment(recipe, ALL)).toEqual([]);
    expect(missingEquipment(recipe, { ...ALL, stove: false })).toEqual(["stove"]);
  });

  it("microwave-safe bowl", () => {
    const recipe = { equipment: ["microwave-safe bowl"], steps: [{ text: "Heat 1 min" }] };
    expect(missingEquipment(recipe, MIN)).toEqual([]);
    expect(missingEquipment(recipe, { ...MIN, microwave: false })).toEqual(["microwave"]);
  });

  it("blender in a step, but mash is not a blender", () => {
    const blend = { equipment: [], steps: [{ text: "Blend until smooth" }] };
    expect(missingEquipment(blend, MIN)).toEqual(["blender"]);
    const mash = { equipment: [], steps: [{ text: "Mash with a fork" }] };
    expect(missingEquipment(mash, MIN)).toEqual([]);
  });

  it("false positives do not trigger oven, blender or toaster", () => {
    const pancakes = { equipment: ["skillet"], steps: [{ text: "Flip the pancakes" }] };
    const potato = { equipment: ["skillet"], steps: [{ text: "Dice the sweet potatoes" }] };
    const potPie = { equipment: ["skillet"], steps: [{ text: "Top the pot pie filling" }] };
    const noBake = { equipment: ["mixing bowl"], steps: [{ text: "no-bake energy bites" }] };
    expect(missingEquipment(pancakes, MIN)).toEqual([]);
    expect(missingEquipment(potato, MIN)).toEqual([]);
    expect(missingEquipment(potPie, MIN)).toEqual([]);
    expect(missingEquipment(noBake, MIN)).toEqual([]);
  });

  it("toaster oven is an oven, never a toaster", () => {
    const recipe = { equipment: [], steps: [{ text: "Toast in the toaster oven" }] };
    expect(missingEquipment(recipe, { ...MIN, toaster: true, oven: false })).toEqual(["oven"]);
  });

  it("toaster", () => {
    const recipe = { equipment: [], steps: [{ text: "Toast the bread in the toaster" }] };
    expect(missingEquipment(recipe, { ...MIN, toaster: true })).toEqual([]);
    expect(missingEquipment(recipe, { ...MIN, toaster: false })).toEqual(["toaster"]);
  });

  it("multi-cooker, rice cooker and air fryer", () => {
    const pressure = { equipment: [], steps: [{ text: "Pressure cook 12 min in the Instant Pot" }] };
    const rice = { equipment: ["rice cooker"], steps: [{ text: "Cook the rice" }] };
    const air = { equipment: [], steps: [{ text: "Air fry 15 min" }] };
    expect(missingEquipment(pressure, MIN)).toEqual(["multiCooker"]);
    expect(missingEquipment(rice, MIN)).toEqual(["riceCooker"]);
    expect(missingEquipment(air, MIN)).toEqual(["airFryer"]);
  });

  it("null kitchen never reports missing tools", () => {
    const recipe = { equipment: ["baking sheet"], steps: [{ text: "Bake at 400°F" }] };
    expect(missingEquipment(recipe, null)).toEqual([]);
  });

  it("returns tools in KITCHEN_TOOLS order, each once", () => {
    const recipe = {
      equipment: ["oven", "baking sheet"],
      steps: [{ text: "Blend the sauce" }, { text: "Roast for 20 min" }],
    };
    expect(missingEquipment(recipe, MIN)).toEqual(["oven", "blender"]);
  });
});

describe("needsLine", () => {
  it("formats one and two tools", () => {
    expect(needsLine(["oven"])).toBe("Needs an oven");
    expect(needsLine(["oven", "blender"])).toBe("Needs an oven and a blender");
  });
});
