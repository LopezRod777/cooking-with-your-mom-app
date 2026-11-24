import { describe, expect, it } from "vitest";
import type { Pet } from "../schemas";
import {
  ageMonths,
  dailyKcal,
  dateKey,
  extrasBudget,
  extrasRemaining,
  extrasUsedToday,
  gramsGivenToday,
  logIsFull,
  pruneExtrasLog,
  stage,
} from "../pets/energy";

// "Now" is 2026-10-31 local noon. Age in months: (now month index) - (birth month index) - 1, never negative.
const NOW = new Date(2026, 9, 31, 12);

function pet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "pet_test01",
    name: "Nala",
    species: "dog",
    weightKg: 10,
    bornYearMonth: "2024-05", // 28 months at NOW
    neutered: true,
    restrictions: [],
    extrasLog: [],
    ...overrides,
  };
}

const near = (actual: number, expected: number, tol = 0.1) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

describe("ageMonths", () => {
  it("born 2026-09 is 0 months through 2026-10-31 and 1 month from 2026-11-01", () => {
    expect(ageMonths("2026-09", new Date(2026, 9, 31, 23))).toBe(0);
    expect(ageMonths("2026-09", new Date(2026, 10, 1, 0))).toBe(1);
  });

  it("never negative (born in a later month)", () => {
    expect(ageMonths("2026-12", NOW)).toBe(0);
  });
});

describe("stage", () => {
  it("dog born 2026-07 (2 months at NOW) is too_young", () => {
    const young = pet({ bornYearMonth: "2026-07" });
    expect(ageMonths(young.bornYearMonth, NOW)).toBe(2);
    expect(stage(young, NOW)).toBe("too_young");
  });

  it("dog 6 months old is puppy", () => {
    expect(stage(pet({ bornYearMonth: "2026-03" }), NOW)).toBe("puppy");
  });

  it("large dog 14 months old is growing_large", () => {
    const big = pet({ bornYearMonth: "2025-07", expectedAdultSize: "large" });
    expect(ageMonths(big.bornYearMonth, NOW)).toBe(14);
    expect(stage(big, NOW)).toBe("growing_large");
  });

  it("large dog 20 months old is adult", () => {
    const big = pet({ bornYearMonth: "2025-01", expectedAdultSize: "large" });
    expect(ageMonths(big.bornYearMonth, NOW)).toBe(20);
    expect(stage(big, NOW)).toBe("adult");
  });

  it("kitten 6 months old is kitten", () => {
    expect(stage(pet({ species: "cat", bornYearMonth: "2026-03" }), NOW)).toBe("kitten");
  });
});

describe("dailyKcal", () => {
  it("10 kg neutered adult dog: RER 393.6, MER 629.8", () => {
    const d = dailyKcal(pet(), NOW);
    near(d.rer, 393.6);
    near(d.mer ?? NaN, 629.8);
    expect(d.factor).toBe(1.6);
    expect(d.basis).toBe("merck");
  });

  it("10 kg intact adult dog: MER 708.5", () => {
    near(dailyKcal(pet({ neutered: false }), NOW).mer ?? NaN, 708.5);
  });

  it("puppy uses factor 2.0 whether neutered or not", () => {
    expect(dailyKcal(pet({ bornYearMonth: "2026-03" }), NOW).factor).toBe(2.0);
  });

  it("too_young: factor and mer are null", () => {
    const d = dailyKcal(pet({ bornYearMonth: "2026-07" }), NOW);
    expect(d.factor).toBeNull();
    expect(d.mer).toBeNull();
  });

  it("large dog 14 months uses the adult factor 1.6 when neutered", () => {
    expect(dailyKcal(pet({ bornYearMonth: "2025-07", expectedAdultSize: "large" }), NOW).factor).toBe(1.6);
  });

  it("neutered 4 kg cat: 70 x 4^0.75 x 1.2", () => {
    const cat = pet({ species: "cat", weightKg: 4, bornYearMonth: "2024-01" });
    const d = dailyKcal(cat, NOW);
    expect(d.factor).toBe(1.2);
    near(d.mer ?? NaN, 70 * Math.pow(4, 0.75) * 1.2, 1e-9);
  });

  it("kitten 6 months: factor 2.5", () => {
    expect(dailyKcal(pet({ species: "cat", bornYearMonth: "2026-03" }), NOW).factor).toBe(2.5);
  });
});

describe("extrasBudget", () => {
  it("10 kg neutered adult dog: 10 % of MER, floored to 62", () => {
    expect(extrasBudget(pet(), NOW)).toEqual({ kcal: 62, rule: "10%", reason: expect.any(String) });
  });

  it("too_young: 0 kcal, rule none, formulated food reason", () => {
    expect(extrasBudget(pet({ bornYearMonth: "2026-07" }), NOW)).toEqual({
      kcal: 0,
      rule: "none",
      reason: "under 4 months: formulated food only",
    });
  });

  it("growing large dog: 5 % of MER", () => {
    const b = extrasBudget(pet({ bornYearMonth: "2025-07", expectedAdultSize: "large" }), NOW);
    expect(b.rule).toBe("5%");
    expect(b.kcal).toBe(31); // floor(629.8 x 0.05)
  });
});

describe("extras log", () => {
  it("dateKey is the local YYYY-MM-DD", () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("extrasRemaining subtracts only today's entries", () => {
    const p = pet({
      extrasLog: [
        { date: "2026-10-31", kcal: 20, label: "chicken" },
        { date: "2026-10-30", kcal: 40, label: "egg" },
      ],
    });
    expect(extrasUsedToday(p, "2026-10-31")).toBe(20);
    expect(extrasRemaining(p, NOW)).toBe(42);
  });

  it("extrasRemaining never goes below 0", () => {
    const p = pet({ extrasLog: [{ date: "2026-10-31", kcal: 500, label: "treats" }] });
    expect(extrasRemaining(p, NOW)).toBe(0);
  });

  it("pruneExtrasLog drops entries older than 7 days (today-7 kept)", () => {
    const p = pet({
      extrasLog: [
        { date: "2026-10-23", kcal: 1, label: "old" },
        { date: "2026-10-24", kcal: 2, label: "edge" },
        { date: "2026-10-31", kcal: 3, label: "today" },
      ],
    });
    expect(pruneExtrasLog(p, NOW).extrasLog.map((e) => e.label)).toEqual(["edge", "today"]);
  });

  it("pruneExtrasLog keeps at most the 60 most recent entries across older days", () => {
    const older = Array.from({ length: 30 }, (_, i) => ({ date: "2026-10-30", kcal: 1, label: `o${i}` }));
    const today = Array.from({ length: 31 }, (_, i) => ({ date: "2026-10-31", kcal: 1, label: `t${i}` }));
    const kept = pruneExtrasLog(pet({ extrasLog: [...older, ...today] }), NOW).extrasLog;
    expect(kept).toHaveLength(60);
    expect(kept.filter((e) => e.date === "2026-10-31")).toHaveLength(31);
    // Today takes 31 of the 60 slots, so 29 older entries stay: the 29 most recent (o1..o29).
    expect(kept[0].label).toBe("o1");
  });

  it("pruneExtrasLog never drops today's entries, even at 61", () => {
    const p = pet({
      extrasLog: Array.from({ length: 61 }, (_, i) => ({ date: "2026-10-31", kcal: 1, label: `e${i}` })),
    });
    const kept = pruneExtrasLog(p, NOW).extrasLog;
    expect(kept).toHaveLength(61);
    expect(kept[0].label).toBe("e0");
  });

  it("pruneExtrasLog keeps every in-window entry when under the cap", () => {
    const p = pet({
      extrasLog: [
        { date: "2026-10-25", kcal: 1, label: "a" },
        { date: "2026-10-30", kcal: 1, label: "b" },
        { date: "2026-10-31", kcal: 1, label: "c" },
      ],
    });
    expect(pruneExtrasLog(p, NOW).extrasLog.map((e) => e.label)).toEqual(["a", "b", "c"]);
  });

  it("logIsFull at 60 today entries, not before", () => {
    const mk = (n: number) => pet({ extrasLog: Array.from({ length: n }, (_, i) => ({ date: "2026-10-31", kcal: 0, label: `e${i}` })) });
    expect(logIsFull(mk(59), "2026-10-31")).toBe(false);
    expect(logIsFull(mk(60), "2026-10-31")).toBe(true);
    expect(logIsFull(mk(60), "2026-10-30")).toBe(false);
  });

  it("gramsGivenToday counts single-food entries and bowl components", () => {
    const p = pet({
      extrasLog: [
        { date: "2026-10-31", kcal: 1, label: "single", foodId: "carrot_cooked", grams: 20 },
        {
          date: "2026-10-31",
          kcal: 9,
          label: "bowl",
          id: "b1",
          components: [
            { foodId: "carrot_cooked", grams: 10, kcal: 3 },
            { foodId: "white_rice_cooked", grams: 30, kcal: 39 },
          ],
        },
        { date: "2026-10-30", kcal: 1, label: "old", foodId: "carrot_cooked", grams: 50 },
      ],
    });
    expect(gramsGivenToday(p, "carrot_cooked", "2026-10-31")).toBe(30);
    expect(gramsGivenToday(p, "white_rice_cooked", "2026-10-31")).toBe(30);
  });
});
