import { describe, expect, it } from "vitest";
import { profileText, SYSTEM_MOM } from "../ai/prompts";
import { CheckIn, Person, Profile } from "../schemas";

describe("profileText diet line", () => {
  it("adds a hard-rule diet line for a non-none diet", () => {
    const text = profileText(Profile.parse({ version: 1, diet: "vegan" }), null);
    expect(text).toContain("Diet (hard rule): Vegan");
  });

  it("omits the diet line when diet is none", () => {
    const text = profileText(Profile.parse({ version: 1, diet: "none" }), null);
    expect(text).not.toContain("Diet (hard rule)");
  });
});

describe("profileText goal line", () => {
  it("states the goal label and rule for a non-default goal", () => {
    const text = profileText(Profile.parse({ version: 1, goal: "clean_bulk" }), null);
    expect(text).toContain("Goal: Build muscle");
    // Rows saved with the old "stronger" goal read as Build muscle.
    expect(Profile.parse({ version: 1, goal: "stronger" }).goal).toBe("clean_bulk");
  });

  it("prints the eat_well line for the default goal", () => {
    const text = profileText(Profile.parse({ version: 1 }), null);
    expect(text).toContain("- Goal: just eat well");
  });
});

describe("profileText kitchen line", () => {
  const kitchen = { stove: true, oven: false, microwave: true, airFryer: false, blender: false, toaster: false, riceCooker: false, multiCooker: false };

  it("lists what the student has and lacks when the kitchen is set", () => {
    const text = profileText(Profile.parse({ version: 1, kitchen }), null);
    expect(text).toContain("- Kitchen (hard rule): has stove, microwave; does NOT have: oven, air fryer, blender, toaster, rice cooker, pressure or slow cooker.");
    expect(text).toContain("No oven → no bake/roast/broil");
  });

  it("omits the kitchen line when the kitchen is null", () => {
    const text = profileText(Profile.parse({ version: 1, kitchen: null }), null);
    expect(text).not.toContain("Kitchen (hard rule)");
  });
});

describe("profileText pets line", () => {
  it("adds the soft pets line for each pet", () => {
    const text = profileText(Profile.parse({ version: 1 }), null, [
      { name: "Rex", species: "dog" },
      { name: "Milo", species: "cat" },
    ]);
    expect(text).toContain("- Pets: dog Rex, cat Milo. When it fits, give each dinner one plain-shareable ingredient");
    expect(text).toContain("Soft preference, never over the other rules.");
  });

  it("omits the pets line when there are no pets", () => {
    expect(profileText(Profile.parse({ version: 1 }), null)).not.toContain("Pets:");
    expect(profileText(Profile.parse({ version: 1 }), null, [])).not.toContain("Pets:");
  });
});

describe("SYSTEM_MOM", () => {
  it("does not mention the kitchen or pets", () => {
    expect(SYSTEM_MOM.startsWith('You are "Mama": warm, direct, practical, zero fluff.')).toBe(true);
    expect(SYSTEM_MOM).not.toContain("Kitchen");
    expect(SYSTEM_MOM).not.toContain("Pets");
  });
});

describe("snack and breakfast guidance", () => {
  it("names smoothies and bowls when snacks or breakfast are on, and stays silent otherwise", () => {
    const on = profileText(Profile.parse({ version: 1, slots: { breakfast: false, lunch: true, dinner: true, snack: true } }), null);
    expect(on).toContain("Snacks and breakfasts: quick, 2 to 6 ingredients, varied across the week: a yogurt bowl with oats and fruit, rice cakes with peanut butter and banana, an egg pudding");
    const off = profileText(Profile.parse({ version: 1, slots: { breakfast: false, lunch: true, dinner: true, snack: false } }), null);
    expect(off).not.toContain("Snacks and breakfasts");
  });

  it("tells Mama when the snack lands, only when snacks are on", () => {
    const snackOn = { breakfast: true, lunch: true, dinner: true, snack: true };
    expect(profileText(Profile.parse({ version: 1, slots: snackOn }), null)).toContain("Snack moment: Mama picks per snack");
    expect(profileText(Profile.parse({ version: 1, slots: snackOn, mealTimes: { snack: "afternoon" } }), null)).toContain("Snack moment: afternoon, between lunch and dinner");
    expect(profileText(Profile.parse({ version: 1, slots: snackOn, mealTimes: { snack: "any" } }), null)).toContain("Snack moment: whenever they are hungry");
    expect(profileText(Profile.parse({ version: 1, slots: { ...snackOn, snack: false } }), null)).not.toContain("Snack moment");
  });
});

describe("profileText never carries personal data", () => {
  it("people and check-ins contribute numbers and wants only", () => {
    const people = [
      Person.parse({ id: "a", name: "Diego", sex: "man", age: 25, heightCm: 178, weightKg: 80, training: "regular", sports: ["weights"], daysPerWeek: 4, minutesPerSession: 60, goal: "clean_bulk" }),
      Person.parse({ id: "b", name: "Ana", sex: "woman", age: 24, heightCm: 163, weightKg: 60, training: "none", goal: "lean" }),
    ];
    const checkins = [CheckIn.parse({ id: "c", personId: "b", at: "2026-11-03", energy: "low", hunger: "hungry", meals: "meh", weightLb: 132, wants: ["faster"], suggested: "up" })];
    const text = profileText(Profile.parse({ version: 1 }), null, [], people, checkins);
    expect(text).toMatch(/Daily energy per person at this table \(estimates\): 2950, 1650 kcal/);
    expect(text).toMatch(/faster meals/);
    expect(text).not.toMatch(/Diego|Ana|woman|\bman\b|\bage\b|178|163|\b80\b|\b60\b|132|weights|cycle|period|2026-11/);
  });

  it("two grown-ups with different goals: counts and phrases, the hard rule and the plateNote request; no names or bodies", () => {
    const people = [
      Person.parse({ id: "a", name: "Diego", sex: "man", age: 25, heightCm: 178, weightKg: 80, training: "none", goal: "clean_bulk" }),
      Person.parse({ id: "b", name: "Noor", sex: "unspecified", goal: "lean" }),
    ];
    const text = profileText(Profile.parse({ version: 1, goal: "clean_bulk" }), null, [], people, []);
    expect(text).toContain("- Goals at this table differ (grown-ups): one getting lean, one building muscle.");
    expect(text).toContain("never lighter for everyone, never bigger for everyone");
    expect(text).toContain('starting with "For the one getting lean,"');
    expect(text).not.toMatch(/- Goal: Build muscle/);
    expect(text).not.toMatch(/Diego|Noor|woman|\bman\b|178|\b80\b/);
  });
  it("grown-ups who agree: their goal, not the profile's", () => {
    const people = [
      Person.parse({ id: "a", name: "Diego", sex: "unspecified", goal: "lean" }),
      Person.parse({ id: "b", name: "Noor", sex: "unspecified", goal: "lean" }),
    ];
    const text = profileText(Profile.parse({ version: 1, goal: "clean_bulk" }), null, [], people, []);
    expect(text).toContain("- Goal: Get lean:");
    expect(text).not.toMatch(/Goals at this table differ/);
  });
  it("nobody at the table: the profile goal as before", () => {
    expect(profileText(Profile.parse({ version: 1, goal: "clean_bulk" }), null, [], [], [])).toContain("- Goal: Build muscle:");
    expect(profileText(Profile.parse({ version: 1 }), null)).toContain("- Goal: just eat well");
  });
  it("a child with a grown-up never makes the goals differ", () => {
    const people = [
      Person.parse({ id: "a", name: "Diego", sex: "unspecified", goal: "lean" }),
      Person.parse({ id: "k", name: "Mateo", relation: "child", sex: "man", age: 6, goal: "grow" }),
    ];
    const text = profileText(Profile.parse({ version: 1 }), null, [], people, []);
    expect(text).toContain("- Goal (grown-ups): Get lean:");
    expect(text).not.toMatch(/Goals at this table differ|plateNote/);
  });
});
