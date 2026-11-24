import { describe, expect, it } from "vitest";
import { CheckIn, DEFAULT_STATE, Person, Profile, type Recipe } from "../schemas";
import { checkinsForRequest, houseGoalLine, houseProteinG, peopleFor, peopleForRequest, plateSplit, platesPromptLines, scalableSide } from "../people";
import { recipeNutrition } from "../nutrition";
import { estimateFor } from "../energy";

const estimateKcal = (p: Person) => estimateFor(p)?.kcal;

const recipe: Recipe = {
  id: "chicken-rice",
  title: "Chicken and rice",
  slot: "dinner",
  cuisine: "Mexican",
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 20,
  ingredients: [
    { key: "chicken_breast", grams: 400 },
    { key: "white_rice", grams: 200 },
    { key: "broccoli", grams: 200 },
  ],
  steps: ["cook"],
  equipment: [],
} as unknown as Recipe;

const diego = Person.parse({ id: "a", name: "Diego", sex: "man", age: 25, heightCm: 178, weightKg: 80, training: "regular", sports: ["weights"], daysPerWeek: 4, minutesPerSession: 60, goal: "clean_bulk" });
const ana = Person.parse({ id: "b", name: "Ana", sex: "woman", age: 24, heightCm: 163, weightKg: 60, training: "none", goal: "lean" });
const people = [diego, ana];
const anon = [Person.parse({ id: "a" }), Person.parse({ id: "b" })];

describe("peopleFor", () => {
  it("one unnamed regular plate per serving when nobody is named", () => {
    const state = { ...DEFAULT_STATE, profile: Profile.parse({ version: 1, servingsPerMeal: 3 }) };
    expect(peopleFor(state)).toHaveLength(3);
    expect(peopleFor(state).every((p) => p.name === "" && p.sex === null)).toBe(true);
  });
  it("named people win over the servings count", () => {
    const state = { ...DEFAULT_STATE, people: [diego] };
    expect(peopleFor(state)).toEqual([diego]);
  });
});

describe("plateSplit", () => {
  it("finds the side and shares it by estimated energy, protein untouched", () => {
    expect(scalableSide(recipe)?.key).toBe("white_rice");
    const split = plateSplit(recipe, 2, people);
    const [l, a] = split.rows;
    expect(l.plate).toBe("hearty");
    expect(a.plate).toBe("light");
    expect(l.sideGrams! + a.sideGrams!).toBe(200);
    expect(l.sideGrams).toBeGreaterThan(a.sideGrams!);
    expect(split.allSame).toBe(false);
    expect(split.leftovers).toBe(0);
    expect(l.kcal!).toBeGreaterThan(a.kcal!);
  });
  it("sauce is not the side: pasta beats pasta sauce", () => {
    const r = { ingredients: [{ key: "pasta", grams: 160 }, { key: "pasta_sauce", grams: 360 }, { key: "breadcrumbs", grams: 50 }] };
    expect(scalableSide(r as unknown as Recipe)?.key).toBe("pasta");
  });
  it("unnamed people with no estimates and no leftovers are not worth a card", () => {
    expect(plateSplit(recipe, 2, anon).worthShowing).toBe(false);
    expect(plateSplit(recipe, 4, anon).worthShowing).toBe(true);
    expect(plateSplit(recipe, 2, people).worthShowing).toBe(true);
  });
  it("same plates: nothing to split, leftovers counted", () => {
    const same = [diego, { ...diego, id: "c", name: "Ethan" }];
    const split = plateSplit(recipe, 4, same);
    expect(split.allSame).toBe(true);
    expect(split.leftovers).toBe(2);
    expect(split.rows[0].sideGrams).toBe(100);
  });
  it("skipped details, different goals: plates differ, the side follows, the card is worth showing", () => {
    const a = Person.parse({ id: "a", name: "Diego", sex: "unspecified", goal: "eat_well" });
    const b = Person.parse({ id: "b", name: "Noor", sex: "unspecified", goal: "lean" });
    const split = plateSplit(recipe, 2, [a, b]);
    expect(split.rows.map((r) => r.plate)).toEqual(["regular", "light"]);
    expect(split.allSame).toBe(false);
    expect((split.rows[0].sideGrams ?? 0) > (split.rows[1].sideGrams ?? 0)).toBe(true);
    expect(platesPromptLines([a, b]).some((l) => /Plates differ at this table/.test(l))).toBe(true);
  });
});

describe("prompt lines", () => {
  it("kcal numbers and the side line when plates differ; never names or bodies", () => {
    const lines = platesPromptLines(people).join("\n");
    expect(lines).toMatch(/2950, 1650 kcal/);
    expect(lines).toMatch(/scalable side/);
    expect(lines).not.toMatch(/Diego|Ana|woman|\bman\b|178|163|80 kg|60 kg|weights|\bage\b|years/);
  });
  it("nothing when nobody has an estimate; no side line when plates match", () => {
    expect(platesPromptLines(anon)).toEqual([]);
    const same = platesPromptLines([diego, { ...diego, id: "c" }]);
    expect(same).toHaveLength(1);
    expect(same[0]).toMatch(/2950, 2950 kcal/);
  });
  it("house protein is the rounded mean of the estimates", () => {
    expect(houseProteinG(people)).toBe(120);
    expect(houseProteinG(anon)).toBeNull();
  });
  it("house protein ignores a child", () => {
    const kid = Person.parse({ id: "k", name: "Mateo", relation: "child", sex: "man", age: 6, activity: "moderate" });
    expect(houseProteinG([...people, kid])).toBe(120);
  });
});

describe("plateSplit with a child at the table", () => {
  const kid = Person.parse({ id: "k", name: "Mateo", relation: "child", sex: "man", age: 6, activity: "moderate" });
  const table = [diego, { ...diego, id: "c", name: "Ethan" }, kid];

  it("the child's plate is smaller and the whole plate scales", () => {
    const split = plateSplit(recipe, 3, table);
    expect(split.wholePlate).toBe(true);
    const [adult, , child] = split.rows;
    expect(child.kcal!).toBeLessThan(adult.kcal!);
    expect(child.sideGrams!).toBeLessThan(adult.sideGrams!);
  });
  it("with no child, wholePlate is false and leftovers stay whole servings", () => {
    const split = plateSplit(recipe, 4, [diego, { ...diego, id: "c", name: "Ethan" }]);
    expect(split.wholePlate).toBe(false);
    expect(split.leftovers).toBe(2);
  });
});

describe("absolute plates with minors (Codex acceptance)", () => {
  // Adult fixture: woman, 25, 150 cm, 76 kg, no training, eat_well → estimate exactly 2000 kcal.
  const adult = Person.parse({ id: "ad", name: "Sam", sex: "woman", age: 25, heightCm: 150, weightKg: 76, training: "none", goal: "eat_well" });
  const kidA = Person.parse({ id: "k1", name: "Mateo", relation: "child", sex: "man", age: 6, activity: "sedentary" });
  const kidB = Person.parse({ id: "k2", name: "Leo", relation: "child", sex: "man", age: 6, activity: "sedentary" });
  // Scale the test dish so it is 600 kcal per serving.
  const base = recipeNutrition(recipe)!;
  const m = (600 * recipe.servings) / base.kcal;
  const dish = { ...recipe, ingredients: recipe.ingredients.map((i) => ({ ...i, grams: Math.round(i.grams * m) })) } as Recipe;

  it("adult 600, kids about 420, leftovers 0.5 at servings 3", () => {
    expect(estimateKcal(adult)).toBe(2000);
    expect(estimateKcal(kidA)).toBe(1400);
    const split = plateSplit(dish, 3, [adult, kidA, kidB]);
    expect(split.wholePlate).toBe(true);
    const [a, ka, kb] = split.rows;
    expect(Math.abs(a.kcal! - 600)).toBeLessThanOrEqual(3);
    expect(Math.abs(ka.kcal! - 420)).toBeLessThanOrEqual(3);
    expect(Math.abs(kb.kcal! - 420)).toBeLessThanOrEqual(3);
    expect(split.leftovers).toBe(0.5);
  });
  it("side grams follow the plates: 2.4 servings of side tonight, not 3 (the rest is in the leftovers)", () => {
    const split = plateSplit(dish, 3, [adult, kidA, kidB]);
    const total = split.rows.reduce((s, r) => s + r.sideGrams!, 0);
    const sideTonight = scalableSide(dish)!.grams * (3 / dish.servings) * (2.4 / 3);
    expect(Math.abs(total - sideTonight)).toBeLessThanOrEqual(10);
  });
});

describe("minors prompt: weight goals and kidNote", () => {
  const adult = Person.parse({ id: "ad", sex: "woman", age: 25, heightCm: 150, weightKg: 76, training: "none", goal: "lean" });
  it("says weight goals belong to adults and the dish stays normal", () => {
    const kid = Person.parse({ id: "k", relation: "child", sex: "man", age: 6, activity: "moderate" });
    const line = platesPromptLines([adult, kid]).join("\n");
    expect(line).toContain("Any weight goal in this profile belongs to the adults");
    expect(line).toContain("keep normal fats and carbs in every recipe");
    expect(line).toContain("omit kidNote when nothing changes");
  });
  it("kidNote is required when a 2–3 year old is at the table", () => {
    const toddler = Person.parse({ id: "t", relation: "child", sex: "woman", age: 3, activity: "sedentary" });
    const line = platesPromptLines([adult, toddler]).join("\n");
    expect(line).toContain("kidNote is required on every recipe");
    expect(line).toContain("one aged 2–3");
  });
});

describe("checkinsForRequest", () => {
  it("nulls weightLb and keeps the wants", () => {
    const c = CheckIn.parse({ id: "c", personId: "a", at: "2026-11-03", energy: "ok", hunger: "fine", meals: "fine", weightLb: 150, wants: ["faster"], suggested: "hold" });
    const [out] = checkinsForRequest([c]);
    expect(out.weightLb).toBeNull();
    expect(out.wants).toEqual(["faster"]);
    expect(c.weightLb).toBe(150);
  });
});

describe("peopleForRequest", () => {
  it("never sends a retired cycle object", () => {
    const [out] = peopleForRequest([{ ...diego, cycle: { starts: ["2026-01-01"], showOnWeek: true } } as never]);
    expect(JSON.stringify(out)).not.toMatch(/cycle|2026-01-01/);
  });

  it("drops name and dates, keeps the numbers", () => {
    const [out] = peopleForRequest([{ ...diego, snoozedUntil: "2026-11-05", addedAt: "2026-10-01" }]);
    expect(out.name).toBe("");
    expect(out.snoozedUntil).toBeNull();
    expect(out.addedAt).toBeNull();
    expect(out.weightKg).toBe(80);
    expect(out.age).toBe(25);
  });
});

describe("prompt line for minors", () => {
  const mateo = Person.parse({ id: "k", name: "Mateo", relation: "child", sex: "man", age: 6, activity: "moderate" });
  const teen = Person.parse({ id: "t", name: "Sofi", relation: "child", sex: "woman", age: 14, activity: "active" });
  it("adds the minors line with bands, kidNote and no names", () => {
    const lines = platesPromptLines([diego, mateo, teen]).join("\n");
    expect(lines).toContain("under 16");
    expect(lines).toContain("kidNote");
    expect(lines).toContain("one aged 4–8, one aged 13–15");
    expect(lines).not.toMatch(/Mateo|Sofi|Diego/);
  });
  it("no minors line when everyone is 16 or over", () => {
    expect(platesPromptLines(people).join("\n")).not.toContain("under 16");
  });
});

describe("children with grown-ups whose goals differ (Codex 2026-11-05)", () => {
  const a = Person.parse({ id: "a", name: "Diego", sex: "unspecified", goal: "eat_well" });
  const b = Person.parse({ id: "b", name: "Noor", sex: "unspecified", goal: "lean" });
  const kid = Person.parse({ id: "k", name: "Mateo", relation: "child", sex: "man", age: 6, goal: "grow" });
  it("mixed table without adult estimates: the goals still split the grown-ups and the child eats less", () => {
    const split = plateSplit(recipe, 3, [a, b, kid]);
    const [la, lb, lk] = split.rows;
    expect([la.plate, lb.plate]).toEqual(["regular", "light"]);
    expect((la.sideGrams ?? 0) > (lb.sideGrams ?? 0)).toBe(true);
    expect((lk.kcal ?? 0) < (lb.kcal ?? 0)).toBe(true);
    expect(split.wholePlate).toBe(true);
  });
  it("a child's plate is measured against 2000 kcal when no grown-up has an estimate, never against itself", () => {
    const split = plateSplit(recipe, 2, [a, kid]);
    const [adult, child] = split.rows;
    expect((child.kcal ?? 0) < (adult.kcal ?? 0)).toBe(true);
  });
  it("prompt: with a child, equal protein and vegetables is said among the grown-ups", () => {
    expect(platesPromptLines([a, b, kid]).some((l) => /shared equally among the grown-ups/.test(l))).toBe(true);
    expect(houseGoalLine({ goal: "eat_well" }, [a, b, kid])).toMatch(/shared equally among the grown-ups/);
    expect(platesPromptLines([a, b]).some((l) => /shared equally; never shrink/.test(l))).toBe(true);
  });
  it("one grown-up on a cut with a child: the goal lives on the plate, the dish stays normal", () => {
    const line = houseGoalLine({ goal: "eat_well" }, [{ ...a, goal: "lean" }, kid]);
    expect(line).toMatch(/^- Goal \(grown-ups\): Get lean: met only at serving time/);
    expect(line).not.toMatch(/lighter meals/);
    expect(houseGoalLine({ goal: "lean" }, [kid])).toMatch(/Goal \(grown-ups\): Get lean/);
    expect(houseGoalLine({ goal: "eat_well" }, [{ ...a, goal: "lean" }])).toMatch(/^- Goal: Get lean: lighter meals/);
  });
});
