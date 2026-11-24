import { describe, expect, it } from "vitest";
import {
  cancelFinishedFor,
  cancelTimer,
  formatMMSS,
  isDone,
  remaining,
  runningTimersFor,
  startTimer,
  timerKey,
} from "../timers";

describe("timers", () => {
  const t0 = 1_000_000;

  it("keys timers by recipe and step", () => {
    expect(timerKey("garlic-lime-shrimp-tacos", 2)).toBe("garlic-lime-shrimp-tacos:2");
  });

  it("counts down from the wall clock, not a counter", () => {
    const timers = startTimer({}, "a:1", 900, "Step 2", t0);
    const timer = timers["a:1"];
    expect(timer.endsAt).toBe(t0 + 900_000);
    expect(remaining(timer, t0 + 60_000)).toBe(840);
    expect(isDone(timer, t0 + 60_000)).toBe(false);
  });

  it("is done at the end time and never goes negative", () => {
    const timer = startTimer({}, "a:1", 900, "Step 2", t0)["a:1"];
    expect(isDone(timer, t0 + 900_000)).toBe(true);
    expect(remaining(timer, t0 + 900_000)).toBe(0);
    expect(remaining(timer, t0 + 2_000_000)).toBe(0);
  });

  it("rounds partial seconds up so the display never shows 0 early", () => {
    const timer = startTimer({}, "a:1", 10, "Step 1", t0)["a:1"];
    expect(remaining(timer, t0 + 1)).toBe(10);
    expect(remaining(timer, t0 + 9_500)).toBe(1);
  });

  it("does not mutate the input map and can cancel", () => {
    const before = startTimer({}, "a:1", 60, "Step 1", t0);
    const after = startTimer(before, "a:2", 60, "Step 2", t0);
    expect(Object.keys(before)).toEqual(["a:1"]);
    expect(Object.keys(after).sort()).toEqual(["a:1", "a:2"]);
    expect(Object.keys(cancelTimer(after, "a:1"))).toEqual(["a:2"]);
  });

  it("formats mm:ss", () => {
    expect(formatMMSS(754)).toBe("12:34");
    expect(formatMMSS(0)).toBe("0:00");
    expect(formatMMSS(59)).toBe("0:59");
    expect(formatMMSS(7200)).toBe("120:00");
  });
});

describe("timers for a recipe", () => {
  const t0 = 1_000_000;
  // Step 2 has 250 s left at t0 + 10 s, step 4 is done, step 1 has 60 s left, other recipe runs too.
  const timers = {
    "soup:1": { endsAt: t0 + 60_000, totalSeconds: 60, label: "Step 2" },
    "soup:3": { endsAt: t0 + 260_000, totalSeconds: 250, label: "Step 4" },
    "soup:4": { endsAt: t0 + 5_000, totalSeconds: 5, label: "Step 5" },
    "rice:0": { endsAt: t0 + 900_000, totalSeconds: 900, label: "Step 1" },
  };

  it("lists only running timers of this recipe, soonest first", () => {
    const running = runningTimersFor(timers, "soup", t0 + 10_000);
    expect(running.map((r) => r.index)).toEqual([1, 3]);
    expect(running[0].timer.label).toBe("Step 2");
  });

  it("keeps running timers and drops only finished ones of this recipe", () => {
    const kept = cancelFinishedFor(timers, "soup", t0 + 10_000);
    expect(Object.keys(kept).sort()).toEqual(["rice:0", "soup:1", "soup:3"]);
  });

  it("does not mutate its input", () => {
    const copy = JSON.stringify(timers);
    cancelFinishedFor(timers, "soup", t0 + 10_000);
    expect(JSON.stringify(timers)).toBe(copy);
  });
});
