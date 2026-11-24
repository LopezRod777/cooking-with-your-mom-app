import { describe, expect, it } from "vitest";
import { dayLabels, tonightDayIndex } from "../../components/week/plan-utils";

// All instants are built from LOCAL noon so the calendar day is the same in every time zone.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const planAt = (createdAt: string, dayIndexes: number[]) => ({
  createdAt,
  days: dayIndexes.map((dayIndex) => ({ dayIndex, label: "", grace: false, meals: [] })),
});

describe("dayLabels", () => {
  it("day 0 is the calendar day of createdAt, then weekdays in order", () => {
    // Thursday 2026-10-29
    const labels = dayLabels(planAt(at(2026, 10, 29), [0, 1, 2]));
    expect(labels.map((l) => l.weekday)).toEqual(["Thursday", "Friday", "Saturday"]);
    expect(labels.map((l) => l.date)).toEqual(["Oct 29", "Oct 30", "Oct 31"]);
  });

  it("wraps across Sunday and the end of the month", () => {
    // Friday 2026-10-30, plan of 5 days: Fri, Sat, Sun, Mon, Tue (Nov 3 is a Tuesday)
    const labels = dayLabels(planAt(at(2026, 10, 30), [0, 1, 2, 3, 4]));
    expect(labels.map((l) => l.weekday)).toEqual(["Friday", "Saturday", "Sunday", "Monday", "Tuesday"]);
    expect(labels[4].date).toBe("Nov 3");
  });

  it("keeps the order of plan.days and the dayIndex of each entry", () => {
    const labels = dayLabels(planAt(at(2026, 10, 30), [2, 0]));
    expect(labels.map((l) => l.dayIndex)).toEqual([2, 0]);
    expect(labels.map((l) => l.weekday)).toEqual(["Sunday", "Friday"]);
  });

  it("uses the local calendar day even for late-evening UTC instants", () => {
    // Local 23:30 on Oct 30 is a different UTC day; the label must still be Oct 30.
    const late = new Date(2026, 9, 30, 23, 30).toISOString();
    expect(dayLabels(planAt(late, [0]))[0].date).toBe("Oct 30");
  });
});

describe("tonightDayIndex", () => {
  const plan = planAt(at(2026, 10, 30), [0, 1, 2]); // Fri Oct 30, Sat Oct 31, Sun Nov 1

  it("picks the day whose date is today", () => {
    expect(tonightDayIndex(plan, new Date(2026, 9, 31, 19))).toBe(1);
    expect(tonightDayIndex(plan, new Date(2026, 10, 1, 8))).toBe(2);
  });

  it("falls back to the first planned day when the plan does not cover today", () => {
    expect(tonightDayIndex(plan, new Date(2026, 9, 29, 19))).toBe(0);
    expect(tonightDayIndex(plan, new Date(2026, 10, 20, 19))).toBe(0);
  });

  it("uses the first entry of plan.days, not dayIndex 0, as the fallback", () => {
    const shifted = planAt(at(2026, 10, 30), [3, 4]);
    expect(tonightDayIndex(shifted, new Date(2026, 0, 1, 19))).toBe(3);
  });
});
