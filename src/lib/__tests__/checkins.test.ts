import { describe, expect, it } from "vitest";
import { CheckIn, Person } from "../schemas";
import { applyMove, dueFor, pendingFor, snooze, suggest, wantsPromptLine, weightTrendLb } from "../checkins";
import { estimateFor } from "../energy";

const diego = Person.parse({ id: "a", name: "Diego", sex: "man", age: 25, heightCm: 178, weightKg: 80, training: "regular", sports: ["weights"], daysPerWeek: 4, minutesPerSession: 60, goal: "clean_bulk", addedAt: "2026-10-01" });
const ana = Person.parse({ id: "b", name: "Ana", sex: "woman", age: 24, heightCm: 163, weightKg: 60, training: "none", goal: "lean", addedAt: "2026-11-01" });
const ci = (over: Partial<CheckIn>): CheckIn => CheckIn.parse({ id: "c1", personId: "a", at: "2026-10-20", energy: "ok", hunger: "fine", meals: "fine", suggested: "hold", ...over });

describe("pendingFor", () => {
  it("skips an open check-in of someone who is now a minor", () => {
    const open = ci({ id: "c9", at: "2026-10-20", applied: false, kept: false });
    expect(pendingFor({ people: [{ ...diego, age: 15 }], checkins: [open] })).toBeNull();
    expect(pendingFor({ people: [diego], checkins: [open] })?.id).toBe("c9");
  });
});

describe("dueFor", () => {
  it("never lists a minor: kids do not check in", () => {
    const kid = { ...diego, id: "k", age: 6, addedAt: "2026-01-01" };
    expect(dueFor({ people: [kid, diego], checkins: [] }, "2026-11-15").map((p) => p.id)).toEqual(["a"]);
  });
  it("due 14 days after the last check-in or the day added; unknown is due; snooze hides one person only", () => {
    const base = { people: [diego, ana], checkins: [] };
    expect(dueFor(base, "2026-11-03").map((p) => p.id)).toEqual(["a"]);
    expect(dueFor(base, "2026-11-15").map((p) => p.id)).toEqual(["a", "b"]);
    expect(dueFor({ ...base, checkins: [ci({ at: "2026-10-25" })] }, "2026-11-03").map((p) => p.id)).toEqual([]);
    expect(dueFor({ ...base, checkins: [ci({ at: "2026-10-20" })] }, "2026-11-03").map((p) => p.id)).toEqual(["a"]);
    // Two due, Diego taps Later: Ana's card still shows; Diego is back after 3 days.
    const snoozed = { ...base, people: [snooze(diego, "2026-11-15"), ana] };
    expect(dueFor(snoozed, "2026-11-15").map((p) => p.id)).toEqual(["b"]);
    expect(dueFor(snoozed, "2026-11-18").map((p) => p.id)).toEqual(["a", "b"]);
    expect(dueFor({ people: [Person.parse({ id: "x" })], checkins: [] }, "2026-11-03")).toHaveLength(1);
  });
  it("an unanswered suggestion stays pending past midnight; the oldest first", () => {
    const state = { people: [diego], checkins: [ci({ id: "old", at: "2026-10-20", suggested: "up" }), ci({ id: "new", at: "2026-11-03", suggested: "down" }), ci({ id: "done", at: "2026-10-01", applied: true })] };
    expect(pendingFor(state)?.id).toBe("old");
    expect(pendingFor({ people: [], checkins: [ci({ kept: true })] })).toBeNull();
  });
});

describe("suggest", () => {
  const answers = { energy: "ok" as const, hunger: "fine" as const, meals: "fine" as const, weightLb: null, wants: [] };
  it("holds when nothing argues", () => {
    expect(suggest(ana, answers, []).move).toBe("hold");
  });
  it("hungry and low → up, even on a cut; stuffed → down unless building", () => {
    expect(suggest(ana, { ...answers, hunger: "hungry", energy: "low" }, []).move).toBe("up");
    expect(suggest(ana, { ...answers, hunger: "stuffed" }, []).move).toBe("down");
    expect(suggest(diego, { ...answers, hunger: "stuffed" }, []).move).toBe("hold");
  });
  it("the scale needs a recent previous weigh-in (10–35 days) and only moves against the goal", () => {
    const today = "2026-11-03";
    expect(suggest(ana, { ...answers, weightLb: 135 }, [], today).move).toBe("hold");
    const prev = [ci({ personId: "b", at: "2026-10-20", weightLb: 132 })];
    expect(weightTrendLb(prev, "b", 135, today)).toEqual({ lb: 3, days: 14 });
    const s = suggest(ana, { ...answers, weightLb: 135 }, prev, today);
    expect(s.move).toBe("down");
    expect(s.why).toMatch(/in 14 days/);
    expect(suggest(ana, { ...answers, weightLb: 130 }, prev, today).move).toBe("hold");
    // Too old or too recent a weigh-in says nothing.
    expect(weightTrendLb([ci({ personId: "b", at: "2026-08-01", weightLb: 132 })], "b", 135, today)).toBeNull();
    expect(weightTrendLb([ci({ personId: "b", at: "2026-11-01", weightLb: 132 })], "b", 135, today)).toBeNull();
    const prevL = [ci({ personId: "a", at: "2026-10-20", weightLb: 176 })];
    expect(suggest(diego, { ...answers, weightLb: 173 }, prevL, today).move).toBe("up");
  });
  it("steps are 150 kcal, capped at ±400, and show up in the estimate", () => {
    const up = applyMove(ana, "up");
    expect(up.kcalAdjust).toBe(150);
    expect(estimateFor(up)!.kcal).toBe(estimateFor(ana)!.kcal + 150);
    let p = ana;
    for (let i = 0; i < 5; i++) p = applyMove(p, "down");
    expect(p.kcalAdjust).toBe(-400);
    expect(suggest(p, { ...answers, hunger: "stuffed" }, []).move).toBe("hold");
    expect(applyMove(ana, "hold")).toBe(ana);
  });
});

describe("wantsPromptLine", () => {
  it("merges the latest wants without names", () => {
    const line = wantsPromptLine([diego, ana], [ci({ wants: ["faster"] }), ci({ id: "c2", personId: "b", at: "2026-11-01", wants: ["filling", "faster"] })]);
    expect(line).toMatch(/faster meals/);
    expect(line).toMatch(/more filling/);
    expect(line).not.toMatch(/Diego|Ana/);
    expect(wantsPromptLine([diego], [])).toBeNull();
  });
  it("wantsPromptLine ignores a child's wishes", () => {
    const kid = Person.parse({ id: "k", name: "Mateo", relation: "child", sex: "man", age: 6, goal: "grow" });
    const c = CheckIn.parse({ id: "c1", personId: "k", at: "2026-11-03", energy: "low", hunger: "hungry", meals: "meh", weightLb: null, wants: ["lighter"], suggested: "hold" });
    expect(wantsPromptLine([kid], [c])).toBeNull();
  });
});
