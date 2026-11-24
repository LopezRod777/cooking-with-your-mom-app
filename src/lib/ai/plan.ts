import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { violatesAllergies, violatesDiet } from "../grocery";
import { SnackMoment, Drink } from "../schemas";
import { perServing } from "../nutrition";
import {
  KITCHEN_TOOLS,
  Recipe,
  WeekPlan,
  type Kitchen,
  type KitchenTool,
  type Location,
  type MealSlot,
  type PlanDay,
  type Profile,
  type Person,
  type CheckIn,
} from "../schemas";
import { anthropic, MODEL } from "./client";
import { missingEquipment, needsLine } from "./kitchen";
import {
  LlmDayRecipes,
  LlmSkeleton,
  LlmSwap,
  type LlmRecipe,
  type LlmSkeleton as LlmSkeletonT,
} from "./llmSchemas";
import { catalogText, profileText, SYSTEM_MOM, type PlanPet } from "./prompts";
import { matchSaved, savedForPlan, savedText } from "./saved";

export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "recipe";
}

function uniqueId(title: string, taken: Set<string>): string {
  const base = slugify(title);
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

const roundOpt = (n: number | undefined) => (n === undefined ? undefined : Math.round(n));

// Maps a loose model recipe to the strict Recipe shape. Throws ZodError if a strict rule fails.
const clip = (s: string | undefined, max: number) =>
  s === undefined ? undefined : s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "\u2026";
const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

// Model output drifts on soft limits (short timers, long tips). Normalize instead of failing.
function toRecipe(r: LlmRecipe, id: string): Recipe {
  return Recipe.parse({
    ...r,
    id,
    title: clip(r.title, 60),
    servings: clampInt(r.servings, 1, 8),
    prepMinutes: Math.max(0, Math.round(r.prepMinutes)),
    cookMinutes: Math.max(0, Math.round(r.cookMinutes)),
    momTip: clip(r.momTip, 160),
    kidNote: clip(r.kidNote, 90),
    plateNote: clip(r.plateNote, 120),
    equipment: r.equipment.slice(0, 8),
    substitutions: r.substitutions.slice(0, 6).map((x) => ({ ...x, note: clip(x.note, 120) ?? "" })),
    ingredients: r.ingredients.map((i) => ({ ...i, display: clip(i.display, 60) ?? "" })),
    steps: r.steps.slice(0, 14).map((s) => {
      const t = roundOpt(s.timerSeconds);
      const timerSeconds = t === undefined || t < 30 ? undefined : Math.min(t, 7200);
      const f = roundOpt(s.tempF);
      const tempF = f === undefined || f < 150 || f > 550 ? undefined : f;
      return { text: clip(s.text, 400) ?? "", timerSeconds, tempF, action: s.action };
    }),
  });
}

const normTitle = (s: string) => s.trim().toLowerCase();

type MealRef = { slot: MealSlot; title: string; servings: number };

// The recipe for a skeleton meal: same title and slot, or the only recipe in that slot.
function matchMeal(pool: LlmRecipe[], meal: { slot: MealSlot; title: string }): LlmRecipe | undefined {
  return (
    pool.find((r) => normTitle(r.title) === normTitle(meal.title) && r.slot === meal.slot) ??
    (() => {
      const bySlot = pool.filter((r) => r.slot === meal.slot);
      return bySlot.length === 1 ? bySlot[0] : undefined;
    })()
  );
}

// Pure: skeleton + per-day recipes -> validated WeekPlan. Throws on missing recipes or allergy violations.
// The skeleton's drink, made strict. Anything off (bad key, no ingredients, an allergen) becomes water: the drink
// is an extra, never a risk.
// Where each snack lands, for the skeleton. "mama" lets her place it by what the snack is.
function snackMomentRule(profile: Profile): string {
  if (!profile.slots.snack) return "";
  const snack = profile.mealTimes.snack;
  if (snack === "mama") return "\n\nSnack moment: for each snack meal set moment to where it fits in the day: midmorning for a smoothie, shake, yogurt or fruit; afternoon for a bar, toast, sandwich or protein bowl; evening for something light and a little sweet.";
  if (snack === "any") return "\n\nSnack moment: set moment to null on snack meals; they eat it whenever they are hungry, so keep it portable.";
  return `\n\nSnack moment: set moment to "${snack}" on every snack meal.`;
}

// The drink line of the skeleton prompt. Off: no drinks at all, so the model sets drink to null everywhere.
export function drinksRule(profile: Pick<Profile, "mealDrinks" | "servingsPerMeal">): string {
  if (!profile.mealDrinks) return "\n\nDrinks: set drink to null on every meal.";
  return `\n\nDrinks: set drink to null for most meals (water is the default and needs nothing). For 3 to 5 meals in the week add a homemade non-alcoholic drink that fits the moment: a smoothie or protein shake with breakfast or as the snack, an agua fresca or fresh juice with lunch or dinner. Use catalog ingredient keys only, with grams for ${profile.servingsPerMeal} servings; sugarG is the sugar per serving in grams (keep it under 12 unless it is 100% fruit juice); how is one sentence. Never alcohol.`;
}

export function toDrink(d: LlmSkeletonT["days"][number]["meals"][number]["drink"], allergies: string[]): Drink | null {
  if (!d) return null;
  const parsed = Drink.safeParse({
    name: clip(d.name, 60),
    kind: d.kind,
    ingredients: d.ingredients.filter((i) => i.grams > 0).map((i) => ({ ...i, display: clip(i.display, 60) ?? "" })),
    sugarG: Math.max(0, Math.round(d.sugarG)),
    how: clip(d.how, 240) ?? "",
  });
  if (!parsed.success) return null;
  if (violatesAllergies({ ingredients: parsed.data.ingredients }, allergies)) return null;
  return parsed.data;
}

// graceDay0: day 0 is the grace day (dinner only, outside the days asked for).
export function assemblePlan(
  skeleton: LlmSkeletonT,
  dayRecipes: LlmRecipe[][],
  allergies: string[] = [],
  createdAt: string = new Date().toISOString(),
  graceDay0: boolean = false,
  mealDrinks: boolean = false,
): WeekPlan {
  if (dayRecipes.length !== skeleton.days.length) {
    throw new Error(`day_count_mismatch: ${dayRecipes.length} vs ${skeleton.days.length}`);
  }

  const taken = new Set<string>();
  const recipes: Record<string, Recipe> = {};
  const idByLlm = new Map<LlmRecipe, string>();

  const days: PlanDay[] = skeleton.days.map((day, i) => {
    const pool = dayRecipes[i];
    const meals = day.meals.map((meal) => {
      const match = matchMeal(pool, meal);
      if (!match) throw new Error(`missing_recipe: ${meal.title}`);

      let recipeId = idByLlm.get(match);
      if (!recipeId) {
        recipeId = uniqueId(match.title, taken);
        idByLlm.set(match, recipeId);
        recipes[recipeId] = toRecipe(match, recipeId);
      }
      const moment = meal.slot === "snack" ? SnackMoment.safeParse(meal.moment) : null;
      return { slot: meal.slot, recipeId, servings: Math.round(meal.servings), drink: mealDrinks ? toDrink(meal.drink, allergies) : null, moment: moment?.success ? moment.data : null };
    });
    return { dayIndex: i, label: day.label, grace: graceDay0 && i === 0, meals };
  });

  const plan = WeekPlan.parse({ version: 1, createdAt, days, recipes });

  for (const recipe of Object.values(plan.recipes)) {
    if (violatesAllergies(recipe, allergies)) {
      throw new Error(`allergy_violation: ${recipe.title}`);
    }
  }
  return plan;
}

const PROTEIN_FLOOR = 0.8;
const TIME_GRACE_MIN = 10;

export type DayEvaluation = {
  proteinG: number;
  problems: string[];
  // Keyed by slugify(recipe title). Only recipes that need a tool the kitchen lacks.
  equipment: Record<string, KitchenTool[]>;
};

// Pure pick: alternatives that need nothing the kitchen lacks.
export function pickCompliant<T extends { equipment: string[]; steps: { text: string; action?: string }[] }>(
  alts: T[],
  kitchen: Kitchen | null,
): T[] {
  return alts.filter((alt) => missingEquipment(alt, kitchen).length === 0);
}

// Pure. Sums protein per serving over the day's meals, checks the slowest recipe's total time and its equipment.
// Each problem is an instruction line for the one retry of that day.
export function evaluateDay(
  meals: MealRef[],
  pool: LlmRecipe[],
  profile: Pick<Profile, "proteinTargetG" | "maxMinutesPerMeal"> & { kitchen?: Kitchen | null },
  opts: { skipProteinFloor?: boolean } = {},
): DayEvaluation {
  let proteinG = 0;
  let maxMinutes = 0;
  const problems: string[] = [];
  const equipment: Record<string, KitchenTool[]> = {};
  for (const meal of meals) {
    const match = matchMeal(pool, meal);
    if (!match) continue;
    let recipe: Recipe;
    try {
      recipe = toRecipe(match, "check");
    } catch {
      problems.push("Previous attempt: a recipe did not match the required format; write every field exactly as specified.");
      continue;
    }
    maxMinutes = Math.max(maxMinutes, recipe.prepMinutes + recipe.cookMinutes);
    proteinG += perServing(recipe, Math.max(1, Math.round(meal.servings)))?.protein_g ?? 0;
    const tools = missingEquipment(recipe, profile.kitchen ?? null);
    if (tools.length > 0) {
      equipment[slugify(recipe.title)] = tools;
      problems.push(
        `Needs equipment they do not have: ${needsLine(tools).replace("Needs ", "")} ("${recipe.title}"). Rewrite it for what they have.`,
      );
    }
  }
  // The grace day is one dinner: the daily protein floor does not apply to it (time and equipment still do).
  if (!opts.skipProteinFloor && proteinG < PROTEIN_FLOOR * profile.proteinTargetG) {
    problems.push(
      `Previous attempt: ${Math.round(proteinG)} g protein vs target ${profile.proteinTargetG} g; add a higher-protein breakfast and a second protein to dinner`,
    );
  }
  if (maxMinutes > profile.maxMinutesPerMeal + TIME_GRACE_MIN) {
    problems.push(`Step times exceed ${profile.maxMinutesPerMeal} min; simplify`);
  }
  return { proteinG: Math.round(proteinG), problems, equipment };
}

export type DayCheck = {
  dayIndex: number;
  proteinG: number;
  targetG: number;
  ok: boolean;
  retried: boolean;
  // Tool ids still missing in that day after the re-roll. May be empty.
  equipment: string[];
};
export type PlanResult = { plan: WeekPlan; checks: DayCheck[] };

function systemBlocks() {
  return [
    { type: "text" as const, text: SYSTEM_MOM },
    {
      type: "text" as const,
      text: catalogText(),
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

const DAY_CONCURRENCY = 4;
const CALL_TIMEOUT_MS = 150_000;
const PLAN_DEADLINE_MS = 240_000;

// Runs fn over items with at most `limit` in flight. Stops starting new items after the first failure.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Whole plan under one deadline. On overrun, in-flight calls are aborted and the error is "plan_timeout".
export async function generateWeekPlan(
  profile: Profile,
  location: Location | null,
  pets: PlanPet[] = [],
  saved: Recipe[] = [],
  people: Person[] = [],
  checkins: CheckIn[] = [],
  opts: { graceDay?: boolean } = {},
): Promise<PlanResult> {
  const controller = new AbortController();
  let timedOut = false;
  const deadlineAt = Date.now() + PLAN_DEADLINE_MS;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PLAN_DEADLINE_MS);
  try {
    return await buildWeekPlan(profile, location, pets, controller.signal, deadlineAt, saved, people, checkins, opts);
  } catch (err) {
    if (timedOut) throw new Error("plan_timeout");
    throw err;
  } finally {
    clearTimeout(deadline);
  }
}

type SkeletonDay = LlmSkeletonT["days"][number];

async function generateDayRecipes(
  day: SkeletonDay,
  profile: Profile,
  location: Location | null,
  pets: PlanPet[],
  callOptions: { timeout: number; signal: AbortSignal },
  retryLines: string[] = [],
  people: Person[] = [],
  checkins: CheckIn[] = [],
): Promise<LlmRecipe[]> {
  const meals = day.meals
    .map((m) => `- ${m.slot}: "${m.title}" (${m.cuisine}, main protein ${m.mainProtein}, servings ${m.servings})`)
    .join("\n");
  const retry = retryLines.length ? `\n${retryLines.join("\n")}` : "";
  const res = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 12000,
    system: systemBlocks(),
    messages: [
      {
        role: "user",
        content: `Write the full recipe for each meal below. Use each meal's exact title, slot and servings. Set id to the slug of the title (lowercase, words joined by hyphens). Quantities are in grams for those servings.\n\nMeals for ${day.label}:\n${meals}${retry}\n\nProfile:\n${profileText(profile, location, pets, people, checkins)}`,
      },
    ],
    output_config: { effort: "low", format: zodOutputFormat(LlmDayRecipes) },
  }, callOptions);
  if (!res.parsed_output) throw new Error(`day_recipes_parse_failed: ${day.label}`);
  return res.parsed_output.recipes;
}

// Time left under the plan deadline; a re-roll starts only with at least this much.
const REROLL_MIN_MS = 40_000;
const REROLL_MAX = 2;

async function buildWeekPlan(
  profile: Profile,
  location: Location | null,
  pets: PlanPet[],
  signal: AbortSignal,
  deadlineAt: number,
  saved: Recipe[] = [],
  people: Person[] = [],
  checkins: CheckIn[] = [],
  opts: { graceDay?: boolean } = {},
): Promise<PlanResult> {
  const callOptions = { timeout: CALL_TIMEOUT_MS, signal };
  // Saved recipes that fit this profile are offered to the skeleton by title; a chosen one is used as saved, not rewritten.
  const reusable = savedForPlan(saved, profile);
  const enabledSlots = (Object.keys(profile.slots) as (keyof Profile["slots"])[]).filter(
    (s) => profile.slots[s],
  );
  // Grace day: the account's first plan starts with tonight's dinner alone; the days asked for begin tomorrow.
  const grace = Boolean(opts.graceDay) && profile.slots.dinner;
  const dayCount = profile.daysToPlan + (grace ? 1 : 0);
  const opening = grace
    ? `Plan tonight plus a ${profile.daysToPlan}-day week for this student. Return days with dayIndex 0 to ${profile.daysToPlan} in order. dayIndex 0 is tonight, labeled "Tonight", with exactly one meal, slot dinner. dayIndex 1 to ${profile.daysToPlan} are full days (label them "Day 1" to "Day ${profile.daysToPlan}") and only include these meal slots: ${enabledSlots.join(", ")}.`
    : `Plan a ${profile.daysToPlan}-day week for this student. Return days with dayIndex 0 to ${
        profile.daysToPlan - 1
      } in order and label each day (for example "Day 1"). Only include these meal slots: ${enabledSlots.join(", ")}.`;

  // Step A: skeleton (titles, slots, protein per meal).
  // 16k, not 4k: adaptive thinking counts against max_tokens, and an 8-day skeleton (grace day + 7) with drinks ran
  // out of room at 4k, so the JSON came back cut off and parse() threw (measured 2026-11-04).
  const skeletonRes = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: systemBlocks(),
    messages: [
      {
        role: "user",
        content: `${opening} Every meal title must be unique across the whole week. Vary the main protein across the week. Each meal's servings must be ${profile.servingsPerMeal}.${drinksRule(profile)}${snackMomentRule(profile)}\n\nProfile:\n${profileText(profile, location, pets, people, checkins)}${savedText(reusable, profile.daysToPlan)}`,
      },
    ],
    output_config: { effort: "medium", format: zodOutputFormat(LlmSkeleton) },
  }, callOptions);
  const skeleton = skeletonRes.parsed_output;
  if (!skeleton) throw new Error("skeleton_parse_failed");
  if (skeleton.days.length !== dayCount) {
    throw new Error(`skeleton_day_count: ${skeleton.days.length} vs ${dayCount}`);
  }
  if (grace) {
    const d0 = skeleton.days[0];
    if (d0.meals.length !== 1 || d0.meals[0].slot !== "dinner") throw new Error("skeleton_grace_day");
  }
  for (const day of skeleton.days) {
    for (const meal of day.meals) {
      if (!enabledSlots.includes(meal.slot)) throw new Error(`skeleton_slot_disabled: ${meal.slot}`);
    }
  }

  // Saved recipes the skeleton picked: kept as saved (ingredients, steps, credit), with their own servings. The model
  // only writes the other meals of that day.
  const savedByDay: LlmRecipe[][] = skeleton.days.map((day) => {
    const picks: LlmRecipe[] = [];
    for (const meal of day.meals) {
      const hit = matchSaved(reusable, meal.title, meal.slot);
      if (!hit || picks.some((p) => normTitle(p.title) === normTitle(hit.title))) continue;
      meal.servings = hit.servings;
      picks.push(hit as unknown as LlmRecipe);
    }
    return picks;
  });
  const llmDays: SkeletonDay[] = skeleton.days.map((day, i) => ({
    ...day,
    meals: day.meals.filter((m) => !savedByDay[i].some((p) => p.slot === m.slot && normTitle(p.title) === normTitle(m.title))),
  }));
  const dayCall = async (i: number, retryLines: string[] = []): Promise<LlmRecipe[]> => {
    const own = llmDays[i].meals.length ? await generateDayRecipes(llmDays[i], profile, location, pets, callOptions, retryLines, people, checkins) : [];
    return [...own, ...savedByDay[i]];
  };

  // Step B: full recipes, one call per day, in parallel.
  const firstPass = await mapWithConcurrency(skeleton.days.map((_, i) => i), DAY_CONCURRENCY, (i) => dayCall(i));

  // Step B2: protein, time and equipment per day. A failing day gets one retry that names the problem; its result is accepted as is.
  const firstEval = skeleton.days.map((day, i) =>
    evaluateDay(day.meals, firstPass[i], profile, { skipProteinFloor: grace && i === 0 }),
  );
  const retryIdx = firstEval.flatMap((e, i) => (e.problems.length ? [i] : []));
  const retryResults = await mapWithConcurrency(retryIdx, DAY_CONCURRENCY, async (i) => {
    try {
      return await dayCall(i, firstEval[i].problems);
    } catch (err) {
      // An unparseable retry keeps the first attempt. Timeouts and aborts still fail the plan.
      if (err instanceof Error && err.message.startsWith("day_recipes_parse_failed")) return null;
      throw err;
    }
  });
  const dayRecipes = [...firstPass];
  retryIdx.forEach((dayIdx, k) => {
    const retried = retryResults[k];
    if (retried) dayRecipes[dayIdx] = retried;
  });

  const kitchen = profile.kitchen ?? null;
  const days = [...skeleton.days];
  let rerolls = 0;
  // Step B3: diet. A recipe whose ingredients break the diet rule (carnivore, keto, paleo, vegan...) gets one swap,
  // inside the shared re-roll budget and deadline, before equipment: the diet is as strict as an allergy. Swap candidates are already diet-filtered (validSwapCandidates).
  if (profile.diet !== "none") {
    diet: for (let i = 0; i < days.length; i++) {
      for (const match of dayRecipes[i]) {
        let breaks = false;
        try {
          breaks = violatesDiet(toRecipe(match, slugify(match.title)), profile.diet);
        } catch {
          breaks = false;
        }
        if (!breaks) continue;
        if (rerolls >= REROLL_MAX || deadlineAt - Date.now() < REROLL_MIN_MS) break diet;
        rerolls++;
        try {
          const current = toRecipe(match, slugify(match.title));
          const otherTitles = dayRecipes.flat().map((r) => r.title).filter((t) => normTitle(t) !== normTitle(match.title));
          const alt = (await compliantSwaps(profile, location, current, otherTitles, pets, people, checkins, callOptions, false))[0];
          if (!alt) continue;
          const replacement: LlmRecipe = { ...alt, slot: match.slot, servings: match.servings };
          const meal = days[i].meals.find((m) => normTitle(m.title) === normTitle(match.title) && m.slot === match.slot);
          if (!meal) continue;
          dayRecipes[i] = dayRecipes[i].map((r) => (r === match ? replacement : r));
          days[i] = { ...days[i], meals: days[i].meals.map((m) => (m === meal ? { ...m, title: replacement.title } : m)) };
        } catch {
          // The original stays; the prompt rule remains the first line of defense.
        }
      }
    }
  }

  // Step B4: equipment. Up to REROLL_MAX failing recipes (plan order) get one swap each, while the deadline allows.
  // Diet went first, so a diet-breaking recipe never loses its swap to a missing tool.
  outer: for (let i = 0; i < days.length; i++) {
    for (const { match } of failingRecipes(days[i], dayRecipes[i], kitchen)) {
      if (rerolls >= REROLL_MAX || deadlineAt - Date.now() < REROLL_MIN_MS) break outer;
      rerolls++;
      try {
        const current = toRecipe(match, slugify(match.title));
        const otherTitles = dayRecipes.flat().map((r) => r.title).filter((t) => normTitle(t) !== normTitle(match.title));
        const alt = (await compliantSwaps(profile, location, current, otherTitles, pets, people, checkins, callOptions, false))[0];
        if (!alt) continue;
        const replacement: LlmRecipe = { ...alt, slot: match.slot, servings: match.servings };
        const meal = days[i].meals.find((m) => normTitle(m.title) === normTitle(match.title) && m.slot === match.slot);
        if (!meal) continue;
        dayRecipes[i] = dayRecipes[i].map((r) => (r === match ? replacement : r));
        days[i] = { ...days[i], meals: days[i].meals.map((m) => (m === meal ? { ...m, title: replacement.title } : m)) };
      } catch {
        // A failed or unparseable swap keeps the original recipe; it is marked below.
      }
    }
  }

  // Anything still failing stays in the plan, marked with the tools it needs.
  const finalRecipes = dayRecipes.map((pool, i) => {
    let out = pool;
    for (const { match, tools } of failingRecipes(days[i], pool, kitchen)) {
      out = out.map((r) => (r === match ? { ...r, needsEquipment: tools } : r));
    }
    return out;
  });

  const checks: DayCheck[] = days.map((day, i) => {
    const e = evaluateDay(day.meals, finalRecipes[i], profile, { skipProteinFloor: grace && i === 0 });
    return {
      dayIndex: i,
      proteinG: e.proteinG,
      targetG: grace && i === 0 ? 0 : profile.proteinTargetG,
      ok: e.problems.length === 0,
      retried: retryIdx.includes(i),
      equipment: [...new Set(Object.values(e.equipment).flat())],
    };
  });

  // Step C: assemble, validate, check allergies.
  return { plan: assemblePlan({ days }, finalRecipes, profile.allergies, undefined, grace, profile.mealDrinks), checks };
}

// The recipes a skeleton day resolves to that need a tool the kitchen lacks, with those tools.
function failingRecipes(
  day: SkeletonDay,
  pool: LlmRecipe[],
  kitchen: Kitchen | null,
): { match: LlmRecipe; tools: KitchenTool[] }[] {
  const out: { match: LlmRecipe; tools: KitchenTool[] }[] = [];
  for (const meal of day.meals) {
    const match = matchMeal(pool, meal);
    if (!match || out.some((o) => o.match === match)) continue;
    let recipe: Recipe;
    try {
      recipe = toRecipe(match, "check");
    } catch {
      continue;
    }
    const tools = missingEquipment(recipe, kitchen);
    if (tools.length > 0) out.push({ match, tools });
  }
  return out;
}

// The text of one swap request. Pure: the same prompt the model sees for 3 alternatives.
export function swapPrompt(
  currentRecipe: Recipe,
  otherTitles: string[],
  profile: Profile,
  location: Location | null,
  pets: PlanPet[],
  people: Person[],
  checkins: CheckIn[],
  retryLines: string[],
): string {
  const current = currentRecipe.ingredients.map((i) => i.display).join("; ");
  const retry = retryLines.length ? `\n${retryLines.join("\n")}` : "";
  return `Give exactly 3 alternatives for this ${currentRecipe.slot} that the student can swap in.\n\nCurrent meal: "${currentRecipe.title}" (${currentRecipe.cuisine}). Its ingredients: ${current}.\n\nRules for the alternatives: same slot (${currentRecipe.slot}); a different main protein from the current meal; each title must differ from all of these: ${otherTitles.length ? otherTitles.map((t) => `"${t}"`).join(", ") : "(none)"}. Set id to the slug of the title. Servings must be ${profile.servingsPerMeal}.${retry}\n\nProfile:\n${profileText(profile, location, pets, people, checkins)}`;
}

// One call for 3 alternatives. Returns the raw candidates that pass the slot, title and allergy rules (may be empty).
async function requestSwaps(
  profile: Profile,
  location: Location | null,
  currentRecipe: Recipe,
  otherTitles: string[],
  pets: PlanPet[],
  people: Person[],
  checkins: CheckIn[],
  callOptions: { timeout: number; signal: AbortSignal } | undefined,
  retryLines: string[],
): Promise<LlmRecipe[]> {
  const res = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 12000,
    system: systemBlocks(),
    messages: [
      {
        role: "user",
        content: swapPrompt(currentRecipe, otherTitles, profile, location, pets, people, checkins, retryLines),
      },
    ],
    output_config: { effort: "low", format: zodOutputFormat(LlmSwap) },
  }, callOptions);
  const candidates = res.parsed_output?.recipes;
  if (!candidates) throw new Error("swap_parse_failed");

  const titlesTaken = new Set(otherTitles.map(normTitle));
  const out: LlmRecipe[] = [];
  for (const candidate of candidates) {
    if (candidate.slot !== currentRecipe.slot) continue;
    if (titlesTaken.has(normTitle(candidate.title))) continue;
    let recipe: Recipe;
    try {
      recipe = toRecipe(candidate, slugify(candidate.title));
    } catch {
      continue;
    }
    if (violatesAllergies(recipe, profile.allergies)) continue;
    if (violatesDiet(recipe, profile.diet)) continue;
    out.push(candidate);
  }
  return out;
}

const fitsKitchen = (candidate: LlmRecipe, kitchen: Kitchen | null) =>
  missingEquipment(toRecipe(candidate, "check"), kitchen).length === 0;

const HUMAN_TOOL: Record<KitchenTool, string> = {
  stove: "stovetop",
  oven: "oven",
  microwave: "microwave",
  airFryer: "air fryer",
  blender: "blender",
  toaster: "toaster",
  riceCooker: "rice cooker",
  multiCooker: "pressure or slow cooker",
};

// Up to 3 alternatives the kitchen can cook. One retry that names the missing tool if every candidate needed something else.
async function compliantSwaps(
  profile: Profile,
  location: Location | null,
  currentRecipe: Recipe,
  otherTitles: string[],
  pets: PlanPet[],
  people: Person[],
  checkins: CheckIn[],
  callOptions: { timeout: number; signal: AbortSignal } | undefined,
  allowRetry = true,
): Promise<LlmRecipe[]> {
  const kitchen = profile.kitchen ?? null;
  const first = await requestSwaps(profile, location, currentRecipe, otherTitles, pets, people, checkins, callOptions, []);
  if (first.length === 0) throw new Error("no_valid_swaps");
  const compliant = first.filter((c) => fitsKitchen(c, kitchen));
  if (compliant.length > 0) return compliant.slice(0, 3);
  // The plan re-roll gets one call per recipe (budget: at most 2 extra calls per plan); user swaps may retry once.
  if (!allowRetry) return [];

  const missing = [...new Set(first.flatMap((c) => missingEquipment(toRecipe(c, "check"), kitchen)))];
  const have = KITCHEN_TOOLS.filter((t) => kitchen?.[t]).map((t) => HUMAN_TOOL[t]);
  const retried = await requestSwaps(profile, location, currentRecipe, otherTitles, pets, people, checkins, callOptions, [
    `Previous alternatives needed: ${missing.map((t) => HUMAN_TOOL[t]).join(", ")}. Only ${have.length ? have.join(" or ") : "no-cook"} recipes.`,
  ]);
  return retried.filter((c) => fitsKitchen(c, kitchen)).slice(0, 3);
}

export async function generateSwaps(
  profile: Profile,
  location: Location | null,
  currentRecipe: Recipe,
  otherTitles: string[],
  pets: PlanPet[] = [],
  people: Person[] = [],
  checkins: CheckIn[] = [],
  callOptions?: { timeout: number; signal: AbortSignal },
): Promise<Recipe[]> {
  const candidates = await compliantSwaps(profile, location, currentRecipe, otherTitles, pets, people, checkins, callOptions);
  const taken = new Set<string>([currentRecipe.id, ...otherTitles.map(slugify)]);
  return candidates.map((c) => toRecipe(c, uniqueId(c.title, taken)));
}
