import { describe, expect, it } from "vitest";
import { Person } from "../schemas";
import { cmFromFtIn, estimateFor, isComplete, kgFromLb, goalSplit, plateLabel, plateLabels, plateWeights, restingKcal, sportKcalPerDay } from "../energy";

const diego = Person.parse({ id: "a", name: "Diego", sex: "man", age: 25, heightCm: 178, weightKg: 80, training: "regular", sports: ["weights"], daysPerWeek: 4, minutesPerSession: 60, goal: "clean_bulk" });
const ana = Person.parse({ id: "b", name: "Ana", sex: "woman", age: 24, heightCm: 163, weightKg: 60, training: "none", goal: "lean" });

describe("restingKcal (Mifflin–St Jeor)", () => {
  it("matches the published equations", () => {
    // men: 10·80 + 6.25·178 − 5·25 + 5 = 1792.5 ; women: 10·60 + 6.25·163 − 5·24 − 161 = 1337.75
    expect(restingKcal(diego)).toBeCloseTo(1792.5, 1);
    expect(restingKcal(ana)).toBeCloseTo(1337.75, 1);
    expect(restingKcal({ ...ana, weightKg: null })).toBeNull();
  });
});

describe("sportKcalPerDay (net METs)", () => {
  it("weights 4×60 min at 80 kg: (5−1)·80·1·4/7", () => {
    expect(sportKcalPerDay(diego)).toBeCloseTo((4 * 80 * 4) / 7, 3);
  });
  it("no training → 0; now and then → one 45-minute session a week", () => {
    expect(sportKcalPerDay(ana)).toBe(0);
    const sometimes = { ...ana, training: "sometimes" as const, sports: ["running" as const] };
    expect(sportKcalPerDay(sometimes)).toBeCloseTo((8.3 * 60 * 0.75) / 7, 3);
  });
});

describe("estimateFor", () => {
  it("builds kcal and protein from goal and training", () => {
    const l = estimateFor(diego)!;
    // (1792.5 × 1.4 + 182.9) × 1.10 ≈ 2962 → 2950 ; protein 80 × 1.6 = 128 → 130
    expect(l.kcal).toBe(2950);
    expect(l.proteinG).toBe(130);
    const a = estimateFor(ana)!;
    // 1337.75 × 1.4 × 0.85 ≈ 1592 → 1600, but the floor resting × 1.2 = 1605 rounds up to 1650 ; protein 60 × 1.8 = 108 → 110
    expect(a.kcal).toBe(1650);
    expect(a.proteinG).toBe(110);
  });
  it("never goes below resting × 1.2, and minors get no deficit", () => {
    const cut = { ...ana, goal: "rapid_fat_loss" as const };
    expect(estimateFor(cut)!.kcal).toBeGreaterThanOrEqual(Math.round((1337.75 * 1.2) / 50) * 50);
    const minor = { ...ana, age: 15, goal: "rapid_fat_loss" as const };
    expect(estimateFor(minor)!.kcal).toBe(estimateFor({ ...ana, age: 15, goal: "eat_well" })!.kcal);
  });
  it("returns null until the body fields are in", () => {
    expect(estimateFor({ ...diego, heightCm: null })).toBeNull();
  });
});

describe("plates from estimates", () => {
  it("weights are kcal ÷ table mean; labels by thresholds", () => {
    const w = plateWeights([diego, ana]);
    expect(w[0]).toBeCloseTo(2950 / 2300, 3);
    expect(w[1]).toBeCloseTo(1650 / 2300, 3);
    expect(w.map(plateLabel)).toEqual(["hearty", "light"]);
  });
  it("one estimate or none → everyone regular, unless the grown-ups' goals differ (then the goals split the side)", () => {
    const [a, b] = plateWeights([diego, { ...ana, weightKg: null }]);
    expect(a).toBeCloseTo(1.1 / ((1.1 + 0.85) / 2), 3);
    expect(b).toBeCloseTo(0.85 / ((1.1 + 0.85) / 2), 3);
    expect(plateWeights([diego, { ...ana, weightKg: null, goal: "clean_bulk" }])).toEqual([1, 1]);
    expect(plateWeights([diego])).toEqual([1]);
  });
});

describe("completeness and units", () => {
  it("the floor holds after rounding", () => {
    const e = estimateFor(ana)!;
    expect(e.kcal).toBeGreaterThanOrEqual(1337.75 * 1.2);
    expect(e.kcal % 50).toBe(0);
  });
  it("values the schema rejects make the card incomplete (fractional age, under 30 kg, under 120 cm)", () => {
    expect(isComplete({ ...ana, age: 13.5 })).toBe(false);
    expect(isComplete({ ...ana, weightKg: 29.9 })).toBe(false);
    expect(isComplete({ ...ana, heightCm: 91.4 })).toBe(false);
    expect(isComplete({ ...ana, heightCm: 231 })).toBe(false);
  });
  it("'rather not say' is complete without numbers: no estimate, a regular plate", () => {
    const quiet = Person.parse({ id: "q", name: "Lily", sex: "unspecified" });
    expect(isComplete(quiet)).toBe(true);
    expect(estimateFor(quiet)).toBeNull();
    expect(plateWeights([diego, quiet, ana]).map(plateLabel)).toEqual(["hearty", "regular", "light"]);
  });
  it("regular training needs sport, days and minutes", () => {
    expect(isComplete(diego)).toBe(true);
    expect(isComplete({ ...diego, sports: [] })).toBe(false);
    expect(isComplete(ana)).toBe(true);
    expect(isComplete({ ...ana, training: null })).toBe(false);
  });
  it("ft/in and lb convert", () => {
    expect(cmFromFtIn(5, 10)).toBeCloseTo(177.8, 1);
    expect(kgFromLb(176)).toBeCloseTo(79.8, 1);
  });
});

describe("plateLabels and goal split", () => {
  const man = (goal: Person["goal"], id = "a") => Person.parse({ id, name: "", sex: "man", age: 25, heightCm: 178, weightKg: 78, training: "none", goal });
  const skipped = (goal: Person["goal"], id: string) => Person.parse({ id, name: "", sex: "unspecified", goal });
  const kid = Person.parse({ id: "k", name: "", relation: "child", sex: "man", age: 6, goal: "grow" });
  it("two estimates alike: the energy decides and plates tie, whatever the goals say", () => {
    expect(plateLabels([man("eat_well"), man("lean", "b")])).toEqual(["regular", "regular"]);
    expect(goalSplit([man("eat_well"), man("lean", "b")])).toBe(false);
  });
  it("no estimates but different goals: the goals decide labels and weights", () => {
    const table = [skipped("eat_well", "a"), skipped("lean", "b")];
    expect(goalSplit(table)).toBe(true);
    expect(plateLabels(table)).toEqual(["regular", "light"]);
    const [a, b] = plateWeights(table);
    expect(a).toBeGreaterThan(b);
    expect(plateLabels([skipped("clean_bulk", "a"), skipped("rapid_fat_loss", "b")])).toEqual(["hearty", "light"]);
  });
  it("one estimate and one skipped card with different goals: still the goals", () => {
    expect(plateLabels([man("eat_well"), skipped("lean", "b")])).toEqual(["regular", "light"]);
  });
  it("no estimates and the same goal: everyone regular, weights 1", () => {
    expect(plateLabels([skipped("lean", "a"), skipped("lean", "b")])).toEqual(["regular", "regular"]);
    expect(plateWeights([skipped("lean", "a"), skipped("lean", "b")])).toEqual([1, 1]);
  });
  it("a child's estimate does not count as a grown-up's: one estimated adult, one skipped, one child → still the goals", () => {
    expect(goalSplit([man("eat_well"), skipped("lean", "b"), kid])).toBe(true);
    expect(plateLabels([man("eat_well"), skipped("lean", "b"), kid]).slice(0, 2)).toEqual(["regular", "light"]);
  });
  it("a child never joins the goal split", () => {
    const labels = plateLabels([skipped("eat_well", "a"), skipped("lean", "b"), kid]);
    expect(labels).toEqual(["regular", "light", "regular"]);
    expect(plateWeights([skipped("eat_well", "a"), skipped("lean", "b"), kid])[2]).toBe(1);
  });
});
