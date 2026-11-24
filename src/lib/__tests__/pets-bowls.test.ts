import { describe, expect, it } from "vitest";
import bowlsJson from "../../../data/pet-bowls.json";
import foodsJson from "../../../data/pet-foods.json";
import type { Pet } from "../schemas";
import { bowlsFor, buildBowlEntry, ceilKcal } from "../pets/bowls";

// "Now" is 2026-10-31 local noon. A 12 kg neutered adult dog: RER 451.3, MER 722.1, extras budget 72 kcal.
const NOW = new Date(2026, 9, 31, 12);

function pet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "pet_test01",
    name: "Rex",
    species: "dog",
    weightKg: 12,
    bornYearMonth: "2024-05",
    neutered: true,
    expectedAdultSize: "medium",
    restrictions: [],
    extrasLog: [],
    ...overrides,
  };
}

const byId = (p: Pet, id: string) => bowlsFor(p, NOW).find((b) => b.bowl.id === id)!;

describe("bowlsFor", () => {
  it("12 kg adult, 72 kcal left: chicken & rice fits, 5 g floor, kcal <= 72", () => {
    const plan = byId(pet(), "dog_chicken_rice");
    expect(plan.fits).toBe(true);
    expect(plan.skipped).toBeUndefined();
    // Weight shares 60/30/10: 72 kcal buys 72 / 1.415 kcal-per-g = 50.9 g of bowl, so chicken 30.5 g -> 30 g,
    // rice 15.3 g -> 15 g, carrot 5.1 g -> 5 g. Kcal: 49 + 19 + 1 = 69.
    expect(plan.grams).toEqual({ chicken_breast_cooked: 30, white_rice_cooked: 15, carrot_cooked: 5 });
    expect(plan.kcal).toBeLessThanOrEqual(72);
    // Exact: 30 g chicken (165/100g) 49.5 + 15 g rice (130) 19.5 + 5 g carrot (35) 1.75 = 70.75, ceiling 71.
    expect(plan.kcal).toBe(71);
  });

  it("every gram value is a multiple of 5", () => {
    for (const b of bowlsFor(pet(), NOW)) {
      for (const g of Object.values(b.grams)) expect(g % 5).toBe(0);
    }
  });

  it("a bowl with an excluded food is skipped as allergen", () => {
    const p = pet({ restrictions: [{ kind: "chicken" }] });
    const plan = byId(p, "dog_chicken_rice");
    expect(plan.skipped).toBe("allergen");
    expect(plan.fits).toBe(false);
    expect(byId(p, "dog_turkey_sweet_potato").skipped).toBeUndefined();
  });

  it("component cap respects gramsGivenToday for the same food", () => {
    // 140 g of chicken already logged today: the 150 g dog cap leaves 10 g for chicken (its share is 30 g).
    const p = pet({
      extrasLog: [{ date: "2026-10-31", kcal: 1, label: "chicken", foodId: "chicken_breast_cooked", grams: 140 }],
    });
    expect(byId(p, "dog_chicken_rice").grams.chicken_breast_cooked).toBe(10);
  });

  it("blocked pet gets an empty list", () => {
    expect(bowlsFor(pet({ restrictions: [{ kind: "kidney" }] }), NOW)).toEqual([]);
  });

  it("no budget left: every bowl is skipped as no_budget", () => {
    const p = pet({ extrasLog: [{ date: "2026-10-31", kcal: 72, label: "used" }] });
    expect(bowlsFor(p, NOW).every((b) => b.skipped === "no_budget")).toBe(true);
  });
});

describe("bowl data", () => {
  it("every bowl sums to 100 % and uses only foods allowed for its species", () => {
    const foods = (foodsJson as unknown as { items: { id: string; species: string[] }[] }).items;
    const bowls = bowlsJson as unknown as Record<string, { components: { foodId: string; pct: number }[] }[]>;
    for (const species of ["dog", "cat"]) {
      const list = bowls[species];
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list.length).toBeLessThanOrEqual(5);
      for (const bowl of list) {
        expect(bowl.components.reduce((s, c) => s + c.pct, 0)).toBe(100);
        for (const c of bowl.components) {
          expect(foods.find((x) => x.id === c.foodId)?.species).toContain(species);
        }
      }
    }
  });
});

describe("buildBowlEntry", () => {
  it("builds one entry with components and kcal within budget", () => {
    const e = buildBowlEntry(pet(), "dog_chicken_rice", NOW, () => "abc12345")!;
    expect(e.id).toBe("abc12345");
    expect(e.label).toBe("Chicken & rice bowl");
    expect(e.components.map((c) => c.foodId)).toEqual(["chicken_breast_cooked", "white_rice_cooked", "carrot_cooked"]);
    expect(e.kcal).toBe(71);
  });

  it("logs the same ceiling that fits checked, for every budget left", () => {
    // 12 kg adult: budget 72. Leave `remaining` kcal by logging the rest, then the bowl must fit and log that plan's kcal.
    for (let remaining = 1; remaining <= 72; remaining++) {
      const p = pet({ extrasLog: [{ date: "2026-10-31", kcal: 72 - remaining, label: "used" }] });
      for (const plan of bowlsFor(p, NOW)) {
        if (!plan.fits) continue;
        expect(plan.kcal).toBeLessThanOrEqual(remaining);
      }
      const entry = buildBowlEntry(p, "dog_chicken_rice", NOW, () => "x");
      const plan = byId(p, "dog_chicken_rice");
      if (entry) {
        expect(entry.kcal).toBe(plan.kcal);
        expect(entry.kcal).toBeLessThanOrEqual(remaining);
      }
    }
  });

  it("returns null when the bowl is skipped, the log is full, or the pet is blocked", () => {
    expect(buildBowlEntry(pet({ restrictions: [{ kind: "chicken" }] }), "dog_chicken_rice", NOW, () => "x")).toBeNull();
    const full = pet({
      extrasLog: Array.from({ length: 60 }, (_, i) => ({ date: "2026-10-31", kcal: 0, label: `e${i}` })),
    });
    expect(buildBowlEntry(full, "dog_turkey_sweet_potato", NOW, () => "x")).toBeNull();
    expect(buildBowlEntry(pet({ restrictions: [{ kind: "diabetes" }] }), "dog_turkey_sweet_potato", NOW, () => "x")).toBeNull();
  });
});

describe("ceilKcal", () => {
  it("Codex example: servings totaling 142.55 kcal round up to 143 and do NOT fit a 139 kcal budget", () => {
    // 35 g of a 407 kcal/100g food (142.45) + 10 g of a 1 kcal/100g food (0.10) = 142.55 kcal.
    const kcal = ceilKcal([
      { kcalPer100g: 407, grams: 35 },
      { kcalPer100g: 1, grams: 10 },
    ]);
    expect(kcal).toBe(143);
    expect(kcal <= 139).toBe(false);
  });

  it("a total of 138.2 kcal rounds up to 139 and fits a 139 kcal budget", () => {
    // 100 g of a 130 kcal/100g food (130) + 10 g of an 82 kcal/100g food (8.2) = 138.2 kcal.
    const kcal = ceilKcal([
      { kcalPer100g: 130, grams: 100 },
      { kcalPer100g: 82, grams: 10 },
    ]);
    expect(kcal).toBe(139);
    expect(kcal <= 139).toBe(true);
  });

  it("an exact whole total is not pushed up by a rounding step", () => {
    expect(ceilKcal([{ kcalPer100g: 165, grams: 100 }])).toBe(165);
  });
});
