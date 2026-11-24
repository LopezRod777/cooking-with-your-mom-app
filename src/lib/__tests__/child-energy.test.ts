import { describe, expect, it } from "vitest";
import { childKcal, childProteinG } from "../childEnergy";
import { estimateFor, isComplete } from "../energy";
import { applyMove, suggest } from "../checkins";
import { DEFAULT_STATE, GOALS, Person, Profile, isChild, isMinor } from "../schemas";

const answers = { energy: "ok" as const, hunger: "stuffed" as const, meals: "fine" as const, weightLb: null, wants: [] };

describe("childKcal (DGA 2020–2025, Table A2-2)", () => {
  it("reads the table cells", () => {
    expect(childKcal(6, "man", "moderate")).toBe(1600);
    expect(childKcal(6, "woman", "sedentary")).toBe(1200);
    expect(childKcal(12, "man", "active")).toBe(2400);
    expect(childKcal(12, "woman", "moderate")).toBe(2000);
    expect(childKcal(2, "woman", "active")).toBe(1000);
    expect(childKcal(10, "unspecified", "moderate")).toBe(1800);
    expect(childKcal(13, "man", "moderate")).toBe(2200);
    expect(childKcal(15, "man", "active")).toBe(3000);
    expect(childKcal(16, "man", "moderate")).toBeNull();
  });
});

describe("childProteinG (DGA Table A1-2)", () => {
  it("reads the RDA bands", () => {
    expect(childProteinG(3, "woman")).toBe(13);
    expect(childProteinG(6, "man")).toBe(19);
    expect(childProteinG(10, "woman")).toBe(34);
    expect(childProteinG(13, "man")).toBe(34);
    expect(childProteinG(15, "woman")).toBe(46);
    expect(childProteinG(15, "man")).toBe(52);
    expect(childProteinG(16, "man")).toBeNull();
  });
});

describe("estimateFor and isComplete for children", () => {
  it("uses the table for a child of 6 and needs only age and sex", () => {
    const kid = Person.parse({ id: "k", age: 6, sex: "man", activity: "moderate" });
    expect(estimateFor(kid)?.kcal).toBe(1600);
    expect(estimateFor(kid)?.proteinG).toBe(19);
    expect(isComplete(kid)).toBe(true);
    expect(isComplete(Person.parse({ id: "k", age: 6 }))).toBe(false);
  });
});

describe("minors under 16", () => {
  it("a 16-year-old gets normal adult rules (cut factor and the −150 step apply)", () => {
    const base = { id: "t", sex: "man" as const, age: 16, heightCm: 175, weightKg: 65, training: "none" as const };
    const cut = estimateFor(Person.parse({ ...base, goal: "rapid_fat_loss", kcalAdjust: -150 }))!;
    const cutNoAdjust = estimateFor(Person.parse({ ...base, goal: "rapid_fat_loss", kcalAdjust: 0 }))!;
    const maintain = estimateFor(Person.parse({ ...base, goal: "eat_well", kcalAdjust: 0 }))!;
    expect(cutNoAdjust.kcal).toBeLessThan(maintain.kcal);
    expect(cut.kcal).toBe(cutNoAdjust.kcal - 150);
  });
  it("a 15-year-old with weight and height gets the table value, not Mifflin", () => {
    const teen = Person.parse({ id: "t", age: 15, sex: "man", activity: "active", heightCm: 170, weightKg: 60, training: "none" });
    expect(estimateFor(teen)?.kcal).toBe(3000);
    expect(isComplete(Person.parse({ id: "t", age: 15, sex: "man" }))).toBe(true);
  });
  it("a minor's stored goal and negative adjustment are normalized on parse", () => {
    const row = Person.parse({ id: "t", age: 15, goal: "rapid_fat_loss", kcalAdjust: -150 });
    expect(row.goal).toBe("grow");
    expect(row.kcalAdjust).toBe(0);
    const adult = Person.parse({ id: "t", age: 16, goal: "rapid_fat_loss", kcalAdjust: -150 });
    expect(adult.goal).toBe("rapid_fat_loss");
    expect(adult.kcalAdjust).toBe(-150);
  });
  it("a check-in can add to a minor's table value, never take from it", () => {
    const kid = Person.parse({ id: "k", age: 6, sex: "man", activity: "moderate", kcalAdjust: 150 });
    expect(estimateFor(kid)?.kcal).toBe(1750);
    expect(estimateFor(Person.parse({ ...kid, kcalAdjust: -150 }))?.kcal).toBe(1600);
  });
  it("applyMove never takes kcal off a minor, but still adds", () => {
    const teen = Person.parse({ id: "t", age: 15, sex: "woman", kcalAdjust: 0 });
    expect(applyMove(teen, "down")).toBe(teen);
    expect(applyMove(teen, "up").kcalAdjust).toBe(150);
    const adult = Person.parse({ id: "a", age: 30, sex: "woman", kcalAdjust: 0 });
    expect(applyMove(adult, "down").kcalAdjust).toBe(-150);
  });
  it("a 15-year-old: no deficit and a negative adjustment is ignored", () => {
    const base = { id: "t", sex: "man" as const, age: 15, heightCm: 170, weightKg: 60, training: "none" as const };
    const cut = estimateFor(Person.parse({ ...base, goal: "rapid_fat_loss", kcalAdjust: -150 }))!;
    const maintain = estimateFor(Person.parse({ ...base, goal: "eat_well", kcalAdjust: 0 }))!;
    expect(cut.kcal).toBe(maintain.kcal);
  });
  it("suggest() never moves a 15-year-old down", () => {
    const teen = Person.parse({ id: "t", age: 15, sex: "woman", heightCm: 160, weightKg: 55, training: "none", goal: "lean" });
    expect(suggest(teen, answers, []).move).toBe("hold");
    const adult = Person.parse({ id: "a", age: 30, sex: "woman", heightCm: 160, weightKg: 55, training: "none", goal: "lean" });
    expect(suggest(adult, answers, []).move).toBe("down");
  });
});

describe("schema and goals", () => {
  it("the house profile accepts grow (draftToProfile copies a child goal)", () => {
    expect(Profile.parse({ ...DEFAULT_STATE.profile, goal: "grow" }).goal).toBe("grow");
  });
  it("grow is the first goal; ages 5 parses, 1 fails", () => {
    expect(GOALS[0].id).toBe("grow");
    expect(Person.safeParse({ id: "k", age: 5 }).success).toBe(true);
    expect(Person.safeParse({ id: "k", age: 1 }).success).toBe(false);
    expect(isChild({ age: 12 })).toBe(true);
    expect(isChild({ age: 13 })).toBe(false);
    expect(isMinor({ age: 15 })).toBe(true);
    expect(isMinor({ age: 16 })).toBe(false);
  });
});

