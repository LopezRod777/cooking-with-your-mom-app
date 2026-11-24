import { beforeEach, describe, expect, it, vi } from "vitest";
import { Person, Profile, Recipe, WeekPlan } from "../schemas";
import { assemblePlan, evaluateDay, generateSwaps, generateWeekPlan, pickCompliant, slugify } from "../ai/plan";
import type { LlmRecipe, LlmSkeleton } from "../ai/llmSchemas";

const parse = vi.hoisted(() => vi.fn());
vi.mock("../ai/client", () => ({ anthropic: { messages: { parse } }, MODEL: "test-model" }));

const CREATED = "2026-10-30T12:00:00.000Z";

function llmRecipe(overrides: Partial<LlmRecipe> = {}): LlmRecipe {
  return {
    id: "ignored-by-assembly",
    title: "Chicken Rice Bowl",
    cuisine: "American",
    slot: "dinner",
    servings: 2,
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: [
      { key: "chicken_breast", grams: 300, display: "2 chicken breasts (about 1 lb)" },
      { key: "white_rice", grams: 180, display: "1 cup white rice" },
    ],
    equipment: ["skillet"],
    steps: [
      { text: "Heat the skillet over medium-high.", timerSeconds: 240.4, tempF: 400, action: "sear" as const },
      { text: "Cook the chicken until 165°F inside.", action: "sear" as const },
    ],
    substitutions: [],
    momTip: undefined,
    imageKey: "chicken-rice-bowl",
    ...overrides,
  };
}

const skeleton: LlmSkeleton = {
  days: [
    {
      dayIndex: 0,
      label: "Day 1",
      meals: [
        { slot: "breakfast", title: "Egg Wrap", cuisine: "American", mainProtein: "eggs", servings: 2 },
        { slot: "dinner", title: "Chicken Rice Bowl", cuisine: "American", mainProtein: "chicken", servings: 2 },
      ],
    },
    {
      dayIndex: 1,
      label: "Day 2",
      meals: [
        { slot: "breakfast", title: "Egg & Toast", cuisine: "American", mainProtein: "eggs", servings: 2 },
        { slot: "dinner", title: "Egg Toast", cuisine: "American", mainProtein: "eggs", servings: 2 },
      ],
    },
  ],
};

const dayRecipes: LlmRecipe[][] = [
  [
    llmRecipe({ title: "Egg Wrap", slot: "breakfast", imageKey: "breakfast-wrap", ingredients: [
      { key: "eggs", grams: 100, display: "2 eggs" },
      { key: "flour_tortillas", grams: 60, display: "1 tortilla" },
    ] }),
    llmRecipe(),
  ],
  [
    llmRecipe({ title: "Egg & Toast", slot: "breakfast", imageKey: "hero", ingredients: [
      { key: "eggs", grams: 100, display: "2 eggs" },
      { key: "whole_wheat_bread", grams: 60, display: "2 slices bread" },
    ] }),
    llmRecipe({ title: "Egg Toast", slot: "dinner", imageKey: "hero", ingredients: [
      { key: "eggs", grams: 100, display: "2 eggs" },
      { key: "whole_wheat_bread", grams: 60, display: "2 slices bread" },
    ] }),
  ],
];

describe("slugify", () => {
  it("builds lowercase hyphen slugs and strips accents", () => {
    expect(slugify("Crème Brûlée Bowl!")).toBe("creme-brulee-bowl");
    expect(slugify("!!!")).toBe("recipe");
  });
});

describe("assemblePlan", () => {
  it("builds a valid WeekPlan from a fixture skeleton and recipes", () => {
    const plan = assemblePlan(skeleton, dayRecipes, [], CREATED);
    expect(() => WeekPlan.parse(plan)).not.toThrow();
    expect(plan.version).toBe(1);
    expect(plan.createdAt).toBe(CREATED);
    expect(plan.days.map((d) => d.dayIndex)).toEqual([0, 1]);
  });

  it("uses slug-of-title ids that line up with the recipes record", () => {
    const plan = assemblePlan(skeleton, dayRecipes, [], CREATED);
    const meal = plan.days[0].meals[1];
    expect(meal.recipeId).toBe("chicken-rice-bowl");
    expect(plan.recipes[meal.recipeId].title).toBe("Chicken Rice Bowl");
    for (const day of plan.days) {
      for (const m of day.meals) expect(plan.recipes[m.recipeId]).toBeDefined();
    }
  });

  it("disambiguates colliding slugs across recipes", () => {
    const plan = assemblePlan(skeleton, dayRecipes, [], CREATED);
    expect(plan.days[1].meals[0].recipeId).toBe("egg-toast");
    expect(plan.days[1].meals[1].recipeId).toBe("egg-toast-2");
  });

  it("rounds loose numbers and drops timers only when absent", () => {
    const plan = assemblePlan(skeleton, dayRecipes, [], CREATED);
    const steps = plan.recipes["chicken-rice-bowl"].steps;
    expect(steps[0].timerSeconds).toBe(240);
    expect(steps[1].timerSeconds).toBeUndefined();
  });

  it("throws allergy_violation when a recipe contains an allergen", () => {
    const withPeanut: LlmRecipe[][] = [
      [
        llmRecipe({ title: "Egg Wrap", slot: "breakfast", ingredients: [
          { key: "eggs", grams: 100, display: "2 eggs" },
          { key: "peanut_butter", grams: 30, display: "2 tbsp peanut butter" },
        ] }),
        llmRecipe(),
      ],
      dayRecipes[1],
    ];
    expect(() => assemblePlan(skeleton, withPeanut, ["peanut"], CREATED)).toThrow(
      "allergy_violation: Egg Wrap",
    );
    expect(() => assemblePlan(skeleton, withPeanut, [], CREATED)).not.toThrow();
  });

  it("throws missing_recipe when a skeleton meal has no matching recipe", () => {
    const missing: LlmRecipe[][] = [[llmRecipe({ title: "Other", slot: "lunch" })], dayRecipes[1]];
    expect(() => assemblePlan(skeleton, missing, [], CREATED)).toThrow("missing_recipe: Egg Wrap");
  });

  it("marks only day 0 as grace when graceDay0 is set, and no day otherwise", () => {
    const graced = assemblePlan(skeleton, dayRecipes, [], CREATED, true);
    expect(graced.days.map((d) => d.grace)).toEqual([true, false]);
    const plain = assemblePlan(skeleton, dayRecipes, [], CREATED);
    expect(plain.days.map((d) => d.grace)).toEqual([false, false]);
  });
});

const ing = (key: string, grams: number) => ({ key, grams, display: `${grams} g ${key}` });
const meal = (slot: "breakfast" | "dinner", title: string, servings = 2) => ({ slot, title, servings });

describe("evaluateDay", () => {
  const target = { proteinTargetG: 100, maxMinutesPerMeal: 30 };

  it("passes a day at or above 80 % of the protein target within the time limit", () => {
    // 600 g chicken breast at 22.5 g/100 g over 2 servings = 67.5 g per serving, per meal.
    // Two such meals = 135 g, above the 80 g floor for a 100 g target.
    const pool = [
      llmRecipe({ title: "Chicken A", slot: "breakfast", ingredients: [ing("chicken_breast", 600), ing("olive_oil", 5)] }),
      llmRecipe({ title: "Chicken B", slot: "dinner", ingredients: [ing("chicken_breast", 600), ing("olive_oil", 5)] }),
    ];
    const result = evaluateDay([meal("breakfast", "Chicken A"), meal("dinner", "Chicken B")], pool, target);
    expect(result.proteinG).toBeGreaterThanOrEqual(80);
    expect(result.problems).toEqual([]);
  });

  it("asks for more protein when the day is under 80 % of target", () => {
    // 60 g whole wheat bread (7.47 g) + 180 g white rice (12.8 g), each over 2 servings: about 10 g per serving day total.
    const pool = [
      llmRecipe({ title: "Plain Toast", slot: "breakfast", ingredients: [ing("whole_wheat_bread", 60), ing("olive_oil", 5)] }),
      llmRecipe({ title: "Rice Plate", slot: "dinner", ingredients: [ing("white_rice", 180), ing("olive_oil", 5)] }),
    ];
    const result = evaluateDay(
      [meal("breakfast", "Plain Toast"), meal("dinner", "Rice Plate")],
      pool,
      { proteinTargetG: 140, maxMinutesPerMeal: 30 },
    );
    expect(result.problems).toEqual([
      "Previous attempt: 10 g protein vs target 140 g; add a higher-protein breakfast and a second protein to dinner",
    ]);
  });

  it("flags a recipe more than 10 minutes over the limit, and not exactly 10", () => {
    const pool = (minutes: [number, number]) => [
      llmRecipe({ title: "Chicken A", slot: "breakfast", prepMinutes: minutes[0], cookMinutes: minutes[1], ingredients: [ing("chicken_breast", 600), ing("olive_oil", 5)] }),
      llmRecipe({ title: "Chicken B", slot: "dinner", prepMinutes: 5, cookMinutes: 5, ingredients: [ing("chicken_breast", 600), ing("olive_oil", 5)] }),
    ];
    const meals = [meal("breakfast", "Chicken A"), meal("dinner", "Chicken B")];
    expect(evaluateDay(meals, pool([20, 25]), target).problems).toEqual(["Step times exceed 30 min; simplify"]);
    expect(evaluateDay(meals, pool([20, 20]), target).problems).toEqual([]);
  });

  it("reports a protein problem for a single low-protein dinner by default, and none with skipProteinFloor", () => {
    const pool = [llmRecipe({ title: "Plain Toast", slot: "dinner", ingredients: [ing("whole_wheat_bread", 60), ing("olive_oil", 5)] })];
    const meals = [meal("dinner", "Plain Toast")];
    const strict = evaluateDay(meals, pool, { proteinTargetG: 100, maxMinutesPerMeal: 30 });
    expect(strict.problems.some((p) => p.includes("protein"))).toBe(true);
    const grace = evaluateDay(meals, pool, { proteinTargetG: 100, maxMinutesPerMeal: 30 }, { skipProteinFloor: true });
    expect(grace.problems.some((p) => p.includes("protein"))).toBe(false);
  });

  it("skips meals whose recipe is missing from the pool", () => {
    const result = evaluateDay([meal("dinner", "Nowhere")], [], { proteinTargetG: 0, maxMinutesPerMeal: 30 });
    expect(result).toEqual({ proteinG: 0, problems: [], equipment: {} });
  });
});

describe("generateWeekPlan checks and one retry", () => {
  const profile = Profile.parse({ version: 1, daysToPlan: 3, proteinTargetG: 140, onboarded: true });
  const skeleton: LlmSkeleton = {
    days: ["Day 1", "Day 2", "Day 3"].map((label, i) => ({
      dayIndex: i,
      label,
      meals: [
        { slot: "breakfast", title: `Breakfast ${i + 1}`, cuisine: "American", mainProtein: "x", servings: 2 },
        { slot: "dinner", title: `Dinner ${i + 1}`, cuisine: "American", mainProtein: "x", servings: 2 },
      ],
    })),
  };
  const withTitles = (t: string, b: LlmRecipe, d: LlmRecipe) => ({ t, b, d });
  const low = (n: number) =>
    withTitles(`Day ${n}`, llmRecipe({ title: `Breakfast ${n}`, slot: "breakfast", ingredients: [ing("whole_wheat_bread", 60), ing("olive_oil", 5)] }),
      llmRecipe({ title: `Dinner ${n}`, slot: "dinner", ingredients: [ing("white_rice", 180), ing("olive_oil", 5)] }));
  const high = (n: number) =>
    withTitles(`Day ${n}`, llmRecipe({ title: `Breakfast ${n}`, slot: "breakfast", ingredients: [ing("chicken_breast", 600), ing("olive_oil", 5)] }),
      llmRecipe({ title: `Dinner ${n}`, slot: "dinner", ingredients: [ing("chicken_breast", 600), ing("olive_oil", 5)] }));
  const pool = (x: { b: LlmRecipe; d: LlmRecipe }) => [x.b, x.d];

  let retryReturns: "high" | "low" | "unparseable";

  beforeEach(() => {
    parse.mockReset();
    retryReturns = "high";
    parse.mockImplementation(async (args: { max_tokens: number; messages: { content: string }[] }) => {
      if (args.max_tokens === 16000) return { parsed_output: skeleton };
      const prompt = args.messages[0].content;
      const label = prompt.match(/Meals for (Day \d+):/)?.[1] ?? "";
      const n = Number(label.split(" ")[1]);
      if (prompt.includes("Previous attempt")) {
        if (retryReturns === "unparseable") return { parsed_output: null };
        return { parsed_output: { recipes: pool(retryReturns === "high" ? high(n) : low(n)) } };
      }
      return { parsed_output: { recipes: pool(n === 1 ? low(n) : high(n)) } };
    });
  });

  it("retries only the failing day once and reports checks per day", async () => {
    const { plan, checks } = await generateWeekPlan(profile, null);
    expect(() => WeekPlan.parse(plan)).not.toThrow();
    expect(parse).toHaveBeenCalledTimes(1 + 3 + 1);
    const retryCall = parse.mock.calls.find((c) => c[0].messages[0].content.includes("Previous attempt"));
    expect(retryCall?.[0].messages[0].content).toContain("Meals for Day 1:");
    expect(checks.map((c) => [c.dayIndex, c.ok, c.retried])).toEqual([
      [0, true, true],
      [1, true, false],
      [2, true, false],
    ]);
    expect(checks[0].targetG).toBe(140);
    expect(checks[0].proteinG).toBeGreaterThanOrEqual(112);
  });

  it("accepts a retry that still misses the target, with no third try", async () => {
    retryReturns = "low";
    const { checks } = await generateWeekPlan(profile, null);
    expect(parse).toHaveBeenCalledTimes(1 + 3 + 1);
    expect(checks[0]).toMatchObject({ dayIndex: 0, ok: false, retried: true });
  });

  it("keeps the first attempt when the retry does not parse", async () => {
    retryReturns = "unparseable";
    const { plan, checks } = await generateWeekPlan(profile, null);
    expect(() => WeekPlan.parse(plan)).not.toThrow();
    expect(parse).toHaveBeenCalledTimes(1 + 3 + 1);
    expect(checks[0]).toMatchObject({ dayIndex: 0, ok: false, retried: true });
  });

  it("asks for tonight plus the days asked for, and rejects a grace day that is not one dinner", async () => {
    parse.mockReset();
    parse.mockImplementationOnce(async () => ({ parsed_output: skeleton }));
    await expect(generateWeekPlan(profile, null, [], [], [], [], { graceDay: true })).rejects.toThrow(
      "skeleton_day_count: 3 vs 4",
    );
    const graceSkeleton: LlmSkeleton = {
      days: [
        { dayIndex: 0, label: "Tonight", meals: [{ slot: "breakfast", title: "Egg Wrap", cuisine: "American", mainProtein: "eggs", servings: 2 }] },
        ...skeleton.days.map((d, i) => ({ ...d, dayIndex: i + 1, label: `Day ${i + 1}` })),
      ],
    };
    parse.mockReset();
    parse.mockImplementationOnce(async () => ({ parsed_output: graceSkeleton }));
    await expect(generateWeekPlan(profile, null, [], [], [], [], { graceDay: true })).rejects.toThrow("skeleton_grace_day");
    const prompt = parse.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("dayIndex 0 to 3");
  });
});

const KITCHEN_NO_OVEN = { stove: true, oven: false, microwave: true, airFryer: false, blender: false, toaster: false, riceCooker: false, multiCooker: false };
const KITCHEN_OVEN = { ...KITCHEN_NO_OVEN, oven: true };

const bakedSalmon = () =>
  llmRecipe({
    title: "Baked Salmon",
    slot: "dinner",
    equipment: ["baking sheet"],
    steps: [{ text: "Bake the salmon at 400°F until 145°F inside.", action: "bake" as const }, { text: "Rest it, then serve.", action: "rest" as const }],
  });

describe("evaluateDay equipment", () => {
  const target = { proteinTargetG: 0, maxMinutesPerMeal: 30 };

  it("flags an oven recipe when the kitchen has no oven", () => {
    const result = evaluateDay([meal("dinner", "Baked Salmon")], [bakedSalmon()], { ...target, kitchen: KITCHEN_NO_OVEN });
    expect(result.problems).toEqual([
      'Needs equipment they do not have: an oven ("Baked Salmon"). Rewrite it for what they have.',
    ]);
    expect(result.equipment).toEqual({ "baked-salmon": ["oven"] });
  });

  it("does not flag the same recipe when the kitchen has an oven", () => {
    const result = evaluateDay([meal("dinner", "Baked Salmon")], [bakedSalmon()], { ...target, kitchen: KITCHEN_OVEN });
    expect(result.problems).toEqual([]);
    expect(result.equipment).toEqual({});
  });

  it("does not flag anything when the kitchen was never asked (null)", () => {
    const result = evaluateDay([meal("dinner", "Baked Salmon")], [bakedSalmon()], { ...target, kitchen: null });
    expect(result.problems).toEqual([]);
    expect(result.equipment).toEqual({});
  });
});

describe("pickCompliant", () => {
  const stovetop = () => llmRecipe({ title: "Skillet Salmon", steps: [{ text: "Sear the salmon in a skillet.", action: "sear" as const }] });
  it("keeps only the alternatives that need nothing the kitchen lacks", () => {
    const kept = pickCompliant([bakedSalmon(), stovetop()], KITCHEN_NO_OVEN);
    expect(kept.map((r) => r.title)).toEqual(["Skillet Salmon"]);
  });
  it("keeps everything when the kitchen is null", () => {
    expect(pickCompliant([bakedSalmon()], null)).toHaveLength(1);
  });
});

describe("generateSwaps equipment", () => {
  const profile = Profile.parse({ version: 1, servingsPerMeal: 2, kitchen: KITCHEN_NO_OVEN });
  const current = Recipe.parse({
    ...llmRecipe({ steps: [{ text: "Heat the skillet.", action: "sear" as const }, { text: "Cook the chicken.", action: "sear" as const }] }),
    id: "chicken-rice-bowl",
  });
  const skillet = (title: string) =>
    llmRecipe({ title, slot: "dinner", steps: [{ text: "Sear it in a skillet over medium-high.", action: "sear" as const }, { text: "Rest it.", action: "rest" as const }] });
  const ovenAlt = (title: string) => bakedSalmon_(title);
  const bakedSalmon_ = (title: string) =>
    llmRecipe({ title, slot: "dinner", steps: [{ text: "Bake it at 400°F until done.", action: "bake" as const }, { text: "Rest it.", action: "rest" as const }] });

  beforeEach(() => {
    parse.mockReset();
  });

  it("drops oven alternatives and returns the compliant ones, with one call", async () => {
    parse.mockResolvedValueOnce({ parsed_output: { recipes: [ovenAlt("Oven Fish"), skillet("Skillet Fish"), ovenAlt("Oven Tofu")] } });
    const alts = await generateSwaps(profile, null, current, []);
    expect(alts.map((r) => r.title)).toEqual(["Skillet Fish"]);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("retries once naming the problem when every alternative needs an oven", async () => {
    parse
      .mockResolvedValueOnce({ parsed_output: { recipes: [ovenAlt("Oven Fish"), ovenAlt("Oven Tofu")] } })
      .mockResolvedValueOnce({ parsed_output: { recipes: [skillet("Skillet Fish")] } });
    const alts = await generateSwaps(profile, null, current, []);
    expect(alts.map((r) => r.title)).toEqual(["Skillet Fish"]);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[1][0].messages[0].content).toContain(
      "Previous alternatives needed: oven. Only stovetop or microwave recipes.",
    );
  });

  it("returns an empty list, not an error, when the retry is still all oven", async () => {
    parse.mockResolvedValue({ parsed_output: { recipes: [ovenAlt("Oven Fish")] } });
    await expect(generateSwaps(profile, null, current, [])).resolves.toEqual([]);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("passes pets into the prompt and callOptions to the SDK call", async () => {
    const callOptions = { timeout: 1000, signal: new AbortController().signal };
    parse.mockResolvedValueOnce({ parsed_output: { recipes: [skillet("Skillet Fish")] } });
    await generateSwaps(profile, null, current, [], [{ name: "Rex", species: "dog" }], [], [], callOptions);
    expect(parse.mock.calls[0][0].messages[0].content).toContain("- Pets: dog Rex.");
    expect(parse.mock.calls[0][1]).toBe(callOptions);
  });

  it("carries the minors at the table into the swap prompt", async () => {
    const kid = Person.parse({ id: "kid", age: 6, relation: "child" });
    parse.mockResolvedValueOnce({ parsed_output: { recipes: [skillet("Skillet Fish")] } });
    await generateSwaps(profile, null, current, [], [], [kid], []);
    expect(parse.mock.calls[0][0].messages[0].content).toContain("under 16");
  });

  it("adds no minors line when nobody at the table is under 16", async () => {
    const adult = Person.parse({ id: "adult", age: 40, relation: "partner" });
    parse.mockResolvedValueOnce({ parsed_output: { recipes: [skillet("Skillet Fish")] } });
    await generateSwaps(profile, null, current, [], [], [adult], []);
    expect(parse.mock.calls[0][0].messages[0].content).not.toContain("under 16");
  });
});

describe("generateWeekPlan equipment re-roll", () => {
  const profile = Profile.parse({ version: 1, daysToPlan: 3, proteinTargetG: 40, onboarded: true, kitchen: KITCHEN_NO_OVEN });
  // Three days with the same two meals each: each day's pool is separate, so repeated titles are fine here.
  const oneDay: LlmSkeleton = {
    days: ["Day 1", "Day 2", "Day 3"].map((label, i) => ({
      dayIndex: i,
      label,
      meals: [
        { slot: "breakfast" as const, title: "Egg Wrap", cuisine: "American", mainProtein: "eggs", servings: 2 },
        { slot: "dinner" as const, title: "Baked Salmon", cuisine: "American", mainProtein: "fish", servings: 2 },
      ],
    })),
  };
  const skillet = () =>
    llmRecipe({ title: "Skillet Salmon", slot: "dinner", steps: [{ text: "Sear the salmon in a skillet.", action: "sear" as const }, { text: "Rest it.", action: "rest" as const }] });
  const ovenDay = () => [
    llmRecipe({ title: "Egg Wrap", slot: "breakfast" }),
    bakedSalmon(),
  ];

  beforeEach(() => {
    parse.mockReset();
  });

  it("swaps a failing recipe for a compliant one and keeps the meal pointing at it", async () => {
    parse.mockImplementation(async (args: { max_tokens: number; messages: { content: string }[] }) => {
      const prompt = args.messages[0].content;
      if (args.max_tokens === 16000) return { parsed_output: oneDay };
      if (prompt.includes("Give exactly 3")) return { parsed_output: { recipes: [skillet()] } };
      return { parsed_output: { recipes: ovenDay() } };
    });
    const { plan, checks } = await generateWeekPlan(profile, null);
    const dinner = plan.days[0].meals.find((m) => m.slot === "dinner");
    expect(plan.recipes[dinner!.recipeId].title).toBe("Skillet Salmon");
    expect(plan.recipes[dinner!.recipeId].needsEquipment).toBeUndefined();
    expect(checks[0]).toMatchObject({ ok: true, equipment: [] });
  });

  it("keeps a recipe no swap can fix, marked with the missing tool", async () => {
    parse.mockImplementation(async (args: { max_tokens: number; messages: { content: string }[] }) => {
      const prompt = args.messages[0].content;
      if (args.max_tokens === 16000) return { parsed_output: oneDay };
      if (prompt.includes("Give exactly 3")) return { parsed_output: { recipes: [bakedSalmon()] } };
      return { parsed_output: { recipes: ovenDay() } };
    });
    const { plan, checks } = await generateWeekPlan(profile, null);
    const dinner = plan.days[0].meals.find((m) => m.slot === "dinner");
    expect(plan.recipes[dinner!.recipeId].title).toBe("Baked Salmon");
    expect(plan.recipes[dinner!.recipeId].needsEquipment).toEqual(["oven"]);
    expect(checks[0]).toMatchObject({ ok: false, retried: true, equipment: ["oven"] });
  });
});
