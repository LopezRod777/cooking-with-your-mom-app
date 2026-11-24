import { describe, expect, it } from "vitest";
import { AppStateWire, DEFAULT_STATE, MealTimes, Profile } from "../schemas";
import { DEFAULT_MEAL_TIMES, clockLabel, mealTimeHint, orderMeals } from "../mealTimes";

describe("meal times", () => {
  it("defaults when the profile predates them, and the wire requires them", () => {
    expect(Profile.parse({ version: 1 }).mealTimes).toEqual(DEFAULT_MEAL_TIMES);
    expect(MealTimes.parse({ snack: "evening" })).toEqual({ ...DEFAULT_MEAL_TIMES, snack: "evening" });
    const { mealTimes: _drop, ...profileWithout } = DEFAULT_STATE.profile;
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, profile: profileWithout }).success).toBe(false);
    expect(AppStateWire.safeParse(DEFAULT_STATE).success).toBe(true);
    expect(MealTimes.safeParse({ breakfast: "25:00" }).success).toBe(false);
  });

  it("orders the day with the snack where the person said, keeping storage indices", () => {
    const meals = [{ slot: "breakfast" }, { slot: "lunch" }, { slot: "dinner" }, { slot: "snack" }] as const;
    expect(orderMeals(meals, DEFAULT_MEAL_TIMES)).toEqual([0, 1, 3, 2]); // Mama picks, no moment yet: afternoon
    // Mama picks and the plan said mid-morning for this snack (a smoothie): it moves up. A fixed setting ignores the moment.
    const withMoment = [{ slot: "breakfast" }, { slot: "lunch" }, { slot: "dinner" }, { slot: "snack", moment: "midmorning" }] as const;
    expect(orderMeals(withMoment, DEFAULT_MEAL_TIMES)).toEqual([0, 3, 1, 2]);
    expect(orderMeals(withMoment, { ...DEFAULT_MEAL_TIMES, snack: "evening" })).toEqual([0, 1, 2, 3]);
    expect(orderMeals(meals, { ...DEFAULT_MEAL_TIMES, snack: "midmorning" })).toEqual([0, 3, 1, 2]);
    expect(orderMeals(meals, { ...DEFAULT_MEAL_TIMES, snack: "evening" })).toEqual([0, 1, 2, 3]);
    expect(orderMeals(meals, { ...DEFAULT_MEAL_TIMES, snack: "any" })).toEqual([0, 1, 2, 3]);
    // A late breakfast after an early lunch is still ordered by the clock.
    expect(orderMeals(meals.slice(0, 2), { ...DEFAULT_MEAL_TIMES, breakfast: "14:00", lunch: "12:00" })).toEqual([1, 0]);
  });

  it("says the time the way Mama would", () => {
    expect(clockLabel("08:00")).toBe("8 am");
    expect(clockLabel("13:00")).toBe("1 pm");
    expect(clockLabel("19:30")).toBe("7:30 pm");
    expect(clockLabel("00:15")).toBe("12:15 am");
    expect(mealTimeHint({ slot: "snack" }, DEFAULT_MEAL_TIMES)).toBe("around 4:30 pm");
    expect(mealTimeHint({ slot: "snack", moment: "midmorning" }, DEFAULT_MEAL_TIMES)).toBe("around 10:30 am");
    expect(mealTimeHint({ slot: "snack" }, { ...DEFAULT_MEAL_TIMES, snack: "any" })).toBe("whenever you’re hungry");
    expect(mealTimeHint({ slot: "dinner" }, DEFAULT_MEAL_TIMES)).toBe("around 7:30 pm");
  });
});
