import { describe, expect, it } from "vitest";
import { parseWellnessText } from "../wellness/parse";

// Shapes modeled on common exports; the vendors' real headers were not verified (research note 2026-11-03).
describe("wellness export parser", () => {
  it("reads a scale CSV in pounds and converts to kg per day", () => {
    const r = parseWellnessText("Date,Weight (lb),BMI\n2026-10-30,176.4,24.1\n2026-10-31,,24.1\n10/31/2026,175.9,24.0\n");
    expect(r.columns).toEqual({ date: "Date", weight: "Weight (lb)", sleep: null, rhr: null });
    expect(r.days).toEqual([{ date: "2026-10-30", weightKg: 80 }, { date: "2026-10-31", weightKg: 79.8 }]);
    expect(r.skipped).toBe(1);
  });

  it("reads a ring export with sleep in minutes and resting heart rate, ignoring scores", () => {
    const r = parseWellnessText('day,Sleep Score,Total Sleep Duration (min),Average Resting Heart Rate,Lowest Resting Heart Rate\n2026-11-01,82,"431",58,52\n2026-11-02,70,392,60,55\n');
    expect(r.columns.sleep).toBe("Total Sleep Duration (min)");
    expect(r.columns.rhr).toBe("Lowest Resting Heart Rate");
    expect(r.days).toEqual([{ date: "2026-11-01", sleepH: 7.2, restingHr: 52 }, { date: "2026-11-02", sleepH: 6.5, restingHr: 55 }]);
  });

  it("reads JSON rows and merges the same day from two rows", () => {
    const r = parseWellnessText(JSON.stringify({ data: [{ date: "2026-11-01T07:00:00Z", weight_kg: 80.4 }, { date: "2026-11-01T23:10:00Z", sleep_hours: 7.5 }] }));
    expect(r.days).toEqual([{ date: "2026-11-01", weightKg: 80.4, sleepH: 7.5 }]);
  });

  it("drops nonsense: no date column, impossible values, empty files", () => {
    expect(parseWellnessText("foo,bar\n1,2\n").days).toEqual([]);
    const r = parseWellnessText("Date,Weight (kg)\n2026-11-01,9\n2026-11-02,900\n2026-11-03,70\n");
    expect(r.days).toEqual([{ date: "2026-11-03", weightKg: 70 }]);
    expect(r.skipped).toBe(2);
    expect(parseWellnessText("").days).toEqual([]);
    expect(parseWellnessText("{not json").days).toEqual([]);
  });
});
