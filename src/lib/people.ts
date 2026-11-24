import { CATALOG } from "./catalog";
import { todayKey } from "./checkins";
import { estimateFor, GOAL_FACTOR, goalSplit, plateLabels, plateWeights } from "./energy";
import { recipeNutrition } from "./nutrition";
import { GOALS, isMinor, Person as PersonSchema, type AppState, type CheckIn, type Person, type Plate, type Profile, type Recipe } from "./schemas";

// People at the table. The split never touches protein or vegetables: everyone gets the same of those. Only the
// scalable side (rice, potatoes, pasta, beans, bread) changes with each person's plate, which Mama sizes from
// their energy estimate (src/lib/energy.ts). Words on screen: Light / Regular / Hearty; calories only behind "Details".

export const PLATE_LABEL: Record<Plate, string> = { light: "Light", regular: "Regular", hearty: "Hearty" };

export function blankPerson(id: string): Person {
  return PersonSchema.parse({ id, addedAt: todayKey() });
}

// Until someone is added, one unnamed regular plate per cooked serving.
export function peopleFor(state: Pick<AppState, "people" | "profile">): Person[] {
  if (state.people.length > 0) return state.people;
  return Array.from({ length: state.profile.servingsPerMeal }, (_, i) => blankPerson(`p${i + 1}`));
}

// The house protein target: the mean of the adults' estimates, or null when nobody has one. Children are left out:
// no verified RDA path drives the house target.
export function houseProteinG(people: Person[]): number | null {
  const ests = people.filter((p) => !isMinor(p)).map((p) => estimateFor(p)?.proteinG).filter((g): g is number => typeof g === "number");
  if (!ests.length) return null;
  return Math.round(ests.reduce((a, b) => a + b, 0) / ests.length / 10) * 10;
}

// Grown-ups whose card says something (a blank card from peopleFor() is not a person yet).
export function realAdults(people: Person[]): Person[] {
  return people.filter((p) => !isMinor(p) && (p.name.trim() !== "" || p.sex !== null || p.weightKg !== null));
}

// True when two or more grown-ups at the table want different things (one cuts, one bulks, one just eats well).
export function adultGoalsDiffer(people: Person[]): boolean {
  return new Set(realAdults(people).map((p) => p.goal)).size >= 2;
}

// How Mama names each goal at the table, lightest first. Never the person's name.
const GOAL_PHRASE: Record<Person["goal"], string> = { rapid_fat_loss: "on a firm cut", lean: "getting lean", eat_well: "just eating well", clean_bulk: "building muscle", grow: "still growing" };
const GOAL_ORDER: Person["goal"][] = ["rapid_fat_loss", "lean", "eat_well", "clean_bulk", "grow"];
const COUNT_WORD = ["none", "one", "two", "three", "four", "five", "six"];

// The goal line of the plan prompt. One grown-up, or several who agree: the goal as today. Several who differ: the
// goals as counts, the hard rule that the recipe itself stays a normal meal for everyone, and the plateNote request.
// Never names, sex, age, height or weight (src/lib/__tests__/prompts.test.ts holds the ban list).
export function houseGoalLine(profile: Pick<Profile, "goal">, people: Person[]): string {
  const adults = realAdults(people);
  const goals = new Set(adults.map((p) => p.goal));
  const single = adults.length === 0 ? profile.goal : goals.size === 1 ? adults[0].goal : null;
  if (single !== null) {
    const goal = GOALS.find((g) => g.id === single);
    if (!goal || goal.id === "eat_well") return "- Goal: just eat well";
    // With children at the table the grown-ups' goal never thins the shared dish: it is met on their plates.
    if (people.some(isMinor) && goal.id !== "grow") {
      return `- Goal (grown-ups): ${goal.label}: met only at serving time through their plate size and sides; the recipe itself (ingredients and grams) is one normal, complete meal for everyone, with normal fats and carbs, never lighter or bigger for everyone.`;
    }
    return `- Goal: ${goal.label}: ${goal.rule}`;
  }
  const counts = GOAL_ORDER.filter((g) => goals.has(g)).map((g) => {
    const n = adults.filter((p) => p.goal === g).length;
    return `${COUNT_WORD[n] ?? n} ${GOAL_PHRASE[g]}`;
  });
  const lightest = GOAL_ORDER.find((g) => goals.has(g)) as Person["goal"];
  return `- Goals at this table differ (grown-ups): ${counts.join(", ")}. Hard rule: the recipe itself (ingredients and grams) is one normal, complete meal for everyone, with normal fats and carbs: never lighter for everyone, never bigger for everyone. The goals are met only at serving time. Give every lunch and dinner one scalable side (rice, potatoes, pasta, beans, tortillas or bread) that can be served in different amounts; protein and vegetables are shared equally${people.some(isMinor) ? " among the grown-ups" : ""}, never shrink them. Add a plateNote (120 characters or fewer) to every recipe: one warm sentence the way a mom talks at the table, starting with "For the one ${GOAL_PHRASE[lightest]}," and saying how the plates are served differently using only this recipe's own ingredients and only the side, a dressing or an added fat, never the protein or vegetables and never a new ingredient, for example "For the one getting lean, a smaller scoop of rice and skip the drizzle; the one building muscle takes the full scoop."; no amounts, grams or fractions (the app shows the grams); never clipped fragments strung together with full stops; when a meal has nothing to scale (a smoothie, a yogurt bowl), say the one tweak that fits or omit plateNote.`;
}

export function personLabel(p: Person, index: number): string {
  return p.name.trim() || `Person ${index + 1}`;
}

const SIDE_RE = /rice|quinoa|pasta|spaghetti|penne|macaroni|noodle|potato|tortilla|bread|pita|bun|couscous|oats|beans|lentil|chickpea|farro|bulgur|polenta|naan/i;
// Things that match a side word but are not the side: pasta sauce, breadcrumbs, rice vinegar, potato starch, bean sprouts.
const NOT_SIDE_RE = /sauce|paste|crumb|vinegar|starch|flour|broth|stock|sprout|milk|water|wine|syrup|cake|chip/i;

// The ingredient that carries the plates' difference: the heaviest side-like ingredient, by grams.
export function scalableSide(recipe: Pick<Recipe, "ingredients">): { key: string; displayName: string; grams: number } | null {
  let best: { key: string; displayName: string; grams: number } | null = null;
  for (const ing of recipe.ingredients) {
    // Short noun for the card: "pasta", not "pasta (spaghetti/penne)".
    const name = (CATALOG[ing.key]?.displayName ?? ing.display ?? ing.key).replace(/\s*\(.*\)\s*$/, "").trim();
    if (!SIDE_RE.test(ing.key) && !SIDE_RE.test(name)) continue;
    if (NOT_SIDE_RE.test(ing.key) || NOT_SIDE_RE.test(name)) continue;
    if (!best || ing.grams > best.grams) best = { key: ing.key, displayName: name, grams: ing.grams };
  }
  return best;
}

export type PlateRow = { person: Person; label: string; plate: Plate; sideGrams: number | null; kcal: number | null };
export type PlateSplit = {
  side: { key: string; displayName: string } | null;
  rows: PlateRow[];
  // Servings cooked beyond tonight's plates.
  leftovers: number;
  // True when every plate is the same, so there is nothing to split.
  allSame: boolean;
  // False when there is nothing worth a card: unnamed people, same plates, no leftovers.
  worthShowing: boolean;
  // True when a child is at the table: the whole plate scales by weight, not only the side.
  wholePlate: boolean;
};

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

// Plate size in absolute terms, for a table with minors: each estimate over the grown-ups' mean kcal (2000 when no
// grown-up has one; never the children's own numbers, or a child would get a full adult plate). Grown-ups without an
// estimate get 1, or their goal factor when the split comes from the goals (see goalSplit). Unlike plateWeights, these do
// not sum to the head count: a child eats less than an adult, so they leave leftovers.
function absolutePlateWeights(people: Person[]): number[] {
  const ests = people.map((p) => estimateFor(p)?.kcal ?? null);
  const adultKcals = people.flatMap((p, i) => (isMinor(p) || ests[i] === null ? [] : [ests[i]!]));
  const ref = adultKcals.length ? adultKcals.reduce((a, b) => a + b, 0) / adultKcals.length : 2000;
  const byGoal = goalSplit(people);
  const adults = people.filter((p) => !isMinor(p));
  const meanFactor = adults.length ? adults.reduce((s, p) => s + GOAL_FACTOR[p.goal], 0) / adults.length : 1;
  return people.map((p, i) => {
    if (isMinor(p)) return ests[i] === null ? 1 : ests[i]! / ref;
    if (byGoal) return GOAL_FACTOR[p.goal] / meanFactor;
    return ests[i] === null || adultKcals.length < 2 ? 1 : ests[i]! / ref;
  });
}

// `servings` is what the recipe is scaled to (what gets cooked). Tonight's plates take `people.length` servings;
// the rest is leftovers. Each plate gets servings/people of everything, and the side is re-shared by plate weight.
export function plateSplit(recipe: Recipe, servings: number, people: Person[]): PlateSplit {
  const n = people.length;
  const factor = servings / recipe.servings;
  const side = scalableSide(recipe);
  const totals = recipeNutrition(recipe);
  const weights = plateWeights(people);
  const plates = plateLabels(people);
  const allSame = plates.every((p) => p === plates[0]);
  const kidsAtTable = people.some(isMinor);
  // With a minor at the table the plates are sized in absolute terms (see absolutePlateWeights); otherwise as before.
  const absWeights = kidsAtTable ? absolutePlateWeights(people) : weights;
  const absSum = absWeights.reduce((s, w) => s + w, 0);
  // Tonight's plates: one serving per person, or the absolute sum when kids eat less (so the side matches the kcal and the leftovers).
  const platesTonight = Math.min(kidsAtTable ? absSum : n, servings);
  const sideTotalTonight = side ? side.grams * factor * (platesTonight / servings) : 0;
  const sidePer100 = side ? CATALOG[side.key]?.per100g : undefined;
  const rows: PlateRow[] = people.map((person, i) => {
    const share = absWeights[i] / absSum;
    const sideGrams = side ? round5(sideTotalTonight * share) : null;
    let kcal: number | null = null;
    if (totals) {
      if (kidsAtTable) {
        // Whole plate, protein and vegetables included: this person's share of the dish, whether or not there is a side.
        kcal = Math.round((totals.kcal / recipe.servings) * absWeights[i]);
      } else {
        const perServingKcal = totals.kcal / recipe.servings;
        // Everything but the side is one serving; the side is this plate's grams instead of one serving's grams.
        const sideServingKcal = side && sidePer100 ? (sidePer100.kcal * side.grams) / 100 / recipe.servings : 0;
        const sidePlateKcal = side && sidePer100 && sideGrams !== null ? (sidePer100.kcal * sideGrams) / 100 : sideServingKcal;
        kcal = Math.round(perServingKcal - sideServingKcal + sidePlateKcal);
      }
    }
    return { person, label: personLabel(person, i), plate: plates[i], sideGrams, kcal };
  });
  const leftovers = kidsAtTable ? Math.max(0, Math.round((servings - absSum) * 2) / 2) : Math.max(0, servings - n);
  const anyNamed = people.some((p) => p.name.trim() !== "");
  return {
    side: side ? { key: side.key, displayName: side.displayName } : null,
    rows,
    leftovers,
    allSame,
    worthShowing: anyNamed || !allSame || leftovers > 0,
    wholePlate: kidsAtTable,
  };
}

// Lines for the plan prompt. Allowed: counts and kcal/protein targets as plain numbers. Never names, sex, age,
// height, weight, sports or anything else about a body (src/lib/__tests__/prompts.test.ts holds the ban list).
export function platesPromptLines(people: Person[]): string[] {
  const ests = people.map((p) => estimateFor(p));
  const kcals = ests.filter((e): e is NonNullable<typeof e> => e !== null).map((e) => e.kcal);
  const lines: string[] = [];
  if (kcals.length > 0) {
    lines.push(`- Daily energy per person at this table (estimates): ${kcals.join(", ")} kcal. Size the servings so one serving of each day's meals adds up near the average of these.`);
  }
  const differ = people.length >= 2 && new Set(plateLabels(people)).size >= 2;
  const minors = people.filter(isMinor);
  if (differ) {
    lines.push(`- Plates differ at this table (some lighter, some heartier): give every lunch and dinner one scalable side (rice, potatoes, pasta, beans, tortillas or bread) that can be served in different amounts. Protein and vegetables are shared equally${minors.length > 0 ? " among the grown-ups" : ""}; never shrink them.`);
  }
  if (minors.length > 0) {
    const adults = people.length - minors.length;
    const bandOf = (age: number) => (age <= 3 ? "2–3" : age <= 8 ? "4–8" : age <= 12 ? "9–12" : "13–15");
    const counts = new Map<string, number>();
    for (const p of minors) counts.set(bandOf(p.age!), (counts.get(bandOf(p.age!)) ?? 0) + 1);
    const bands = ["2–3", "4–8", "9–12", "13–15"]
      .filter((b) => counts.has(b))
      .map((b) => `${counts.get(b) === 1 ? "one" : counts.get(b)} aged ${b}`)
      .join(", ");
    const kidNote = counts.has("2–3") ? "kidNote is required on every recipe" : "omit kidNote when nothing changes";
    lines.push(
      `- At this table: ${adults} adult(s) and ${minors.length} under 16 (${bands}). For them: nutrient-dense meals (dairy, leafy greens, iron-rich foods), generous portions, never a cut; keep spice on the side; for ages 2–3 no whole nuts, whole grapes or coin-cut rounds. Add a kidNote (90 characters or fewer) to every recipe: one warm sentence the way a mom talks at the table, starting with "For the little ones," and saying the one or two tweaks for them, for example "For the little ones, go easy on the chili and cut the chicken small so it's easy to chew"; never clipped fragments separated by periods; ${kidNote}. Any weight goal in this profile belongs to the adults and is met through their plate size and sides, never by making the shared dish itself lighter: keep normal fats and carbs in every recipe.`,
    );
  }
  return lines;
}

// What the plan request carries: numbers and plate facts, never identity. Name and dates stay on the device.
export function peopleForRequest(people: Person[]): Person[] {
  // A saved row from before period tracking may still carry `cycle`: it is dropped here so the dates never leave the device.
  return people.map((p) => ({ ...p, name: "", snoozedUntil: null, addedAt: null, cycle: undefined }) as Person);
}

// Check-ins sent with the plan: only `wants` reach the prompt, so the weight is never sent.
export function checkinsForRequest(checkins: CheckIn[]): CheckIn[] {
  return checkins.map((c) => ({ ...c, weightLb: null }));
}
