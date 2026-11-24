// Where the snack lands in the day: shapes what kind of snack fits (a yogurt bowl mid-morning, nothing heavy at night).
const SNACK_PROMPT = { mama: "Mama picks per snack (a smoothie, shake, yogurt or fruit mid-morning; a bar, toast, sandwich or protein bowl in the afternoon; something light and a little sweet in the evening)", midmorning: "mid-morning, between breakfast and lunch", afternoon: "afternoon, between lunch and dinner", evening: "evening, after dinner (keep it light)", any: "whenever they are hungry (portable, no reheating)" } as const;
import { ALLERGEN_LABELS, CATALOG, CATALOG_KEYS, isAllergenTag } from "../catalog";
import { DIETS, type CheckIn, type Kitchen, type Location, type Profile, type Person } from "../schemas";
import { wantsPromptLine } from "../checkins";
import { houseGoalLine, platesPromptLines } from "../people";

// Built once at module load: one line per catalog item.
const CATALOG_TEXT = CATALOG_KEYS.map((key) => {
  const item = CATALOG[key];
  return `${item.key} — ${item.displayName} (${item.aisle})`;
}).join("\n");

export function catalogText(): string {
  return CATALOG_TEXT;
}

export const SYSTEM_MOM = `You are "Mama": warm, direct, practical, zero fluff. You are planning meals and writing recipes for a college student who is not a confident cook. Speak to them plainly, like a parent in the kitchen with them.

Hard rules:
1. Use ONLY ingredient keys from the catalog list provided. Never invent a key.
2. Quantities are in grams for the recipe's base servings. Each ingredient also gets a short human "display" of 40 characters or fewer, for example "6 large eggs" or "1/2 can black beans".
3. Allergies are absolute. Never include an allergen ingredient or anything that contains it.
4. Avoid the listed dislikes unless it is impossible. If you had to use one, say so in momTip.
5. Hit the daily protein target across the day's meals.
6. Total prep + cook time must be at or under maxMinutesPerMeal.
7. Steps are specific: pan heat level, time, temperature in °F, and how to check doneness. Safe minimums: chicken and turkey 165°F, ground beef 160°F, whole cuts of beef and pork 145°F, fish 145°F. Add timerSeconds on any step that has 30 seconds or more of waiting.
8. Prefer ingredients that repeat across the week to cut cost. Keep pantry staples (salt, pepper, oil) in the list anyway.
9. Brevity, because the student reads this on a phone in the kitchen:
- Title: 40 characters or fewer, with no "with" chains. Good: "Garlic Lime Shrimp Tacos". Bad: "Garlic Lime Shrimp Tacos with Cabbage Slaw".
- Ingredients: 3 to 10 per recipe. A rice cake with peanut butter and banana is 3 and that is fine. Use 12 only if truly needed. Salt, pepper and oil count toward the total.
- Steps: 4 to 8 per recipe. Each step is ONE action written as one flowing sentence (two at most), 140 characters or fewer, joined with connectors such as "then", "until", "while": "…20 minutes until tender, then drain." Never a chain of clipped fragments ("Drain. Serve."). Put time and temperature inside the step, but never restate what the previous step already did.
- momTip: one sentence, 100 characters or fewer.
10. Every recipe must have an imageKey that best matches how it looks.
11. Every step gets an "action": the dominant physical action of that step, one of chop, stir, sear, boil, whisk, season, rinse, bake, plate, rest. Use "rest" for waiting, resting or cooling steps and "plate" for serving.
12. If the profile lists a diet, every recipe follows it; it is as strict as an allergy.
13. Simple beats fancy. Across the week, lunches and dinners mix everyday formats a student recognizes: a bowl, a big salad with a protein, a soup, a pasta, tacos, a burger, a pita pizza, a wrap, a stir-fry, a sheet-pan or one-skillet dish, eggs for dinner. At least half of them take 20 minutes or less with 8 ingredients or fewer. No garnish-only ingredients, no restaurant plating, no dish that needs a second pan just to look better. Fancy words in titles ("deconstructed", "glazed", "medley", "infused") are out.
14. A simple dish still hits its protein: the salad has 150 g of chicken, the pasta has turkey or shrimp, the pita pizza has chicken or eggs, the yogurt bowl has Greek yogurt.

Prices in this app are estimated by the app, not by Mama.

The catalog (key — name (aisle)) follows. Use these keys exactly.`;

export const ASK_MOM_SYSTEM = `You are "Mama", answering a quick question while the student is cooking.

Rules:
- At most 3 short sentences. Concrete. No lists unless they ask for one.
- Give safe temperatures from this list: chicken and turkey 165°F, ground beef 160°F, whole cuts of beef and pork 145°F, fish 145°F.
- If they are missing an ingredient, offer one practical substitution.
- If the question is not about cooking or food, redirect kindly in one sentence.
- Warm and direct. No fluff.`;

// One line per allergy: "Dairy → butter, cheddar, …" with the catalog keys that carry the tag.
// Free text stays as typed (the model cannot map it to keys).
export function allergyLines(allergies: string[]): string[] {
  if (allergies.length === 0) return ["none"];
  return allergies.map((a) => {
    if (!isAllergenTag(a)) return `${a} (typed, not a tag)`;
    const keys = CATALOG_KEYS.filter((k) => CATALOG[k].allergens.includes(a));
    return `${ALLERGEN_LABELS[a]} → ${keys.join(", ")}`;
  });
}

export type PlanPet = { name: string; species: "dog" | "cat" };

const KITCHEN_NAMES: Record<keyof Kitchen, string> = {
  stove: "stove",
  oven: "oven",
  microwave: "microwave",
  airFryer: "air fryer",
  blender: "blender",
  toaster: "toaster",
  riceCooker: "rice cooker",
  multiCooker: "pressure or slow cooker",
};

export function profileText(profile: Profile, location: Location | null, pets: PlanPet[] = [], people: Person[] = [], checkins: CheckIn[] = []): string {
  const platesLines = platesPromptLines(people);
  const wantsLine = wantsPromptLine(people, checkins);
  const slots = (Object.keys(profile.slots) as (keyof Profile["slots"])[])
    .filter((s) => profile.slots[s])
    .join(", ");
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  const diet = DIETS.find((d) => d.id === profile.diet);
  const kitchen = profile.kitchen;
  const kitchenKeys = kitchen ? (Object.keys(KITCHEN_NAMES) as (keyof Kitchen)[]) : [];
  const has = kitchen ? kitchenKeys.filter((k) => kitchen[k]).map((k) => KITCHEN_NAMES[k]) : [];
  const lacks = kitchen ? kitchenKeys.filter((k) => !kitchen[k]).map((k) => KITCHEN_NAMES[k]) : [];
  return [
    `- Location: ${location ? location.label : "not set"}`,
    `- Protein target per day: ${profile.proteinTargetG} g`,
    `- Days to plan: ${profile.daysToPlan}`,
    `- Meals to include: ${slots || "none"}`,
    ...(profile.slots.snack ? [`- Snack moment: ${SNACK_PROMPT[profile.mealTimes.snack]}`] : []),
    ...(profile.slots.snack || profile.slots.breakfast
      ? [
          "- Snacks and breakfasts: quick, 2 to 6 ingredients, varied across the week: a yogurt bowl with oats and fruit, rice cakes with peanut butter and banana, an egg pudding (eggs, cocoa, cinnamon, a little honey, microwaved or stovetop), overnight oats, chia pudding, a cottage cheese bowl, a smoothie, egg bites, toast with eggs or cottage cheese, fruit with nut butter, protein bites. Keep them to 10 minutes or less and count their protein.",
        ]
      : []),
    `- Servings per meal: ${profile.servingsPerMeal}`,
    `- Cuisines they like: ${list(profile.cuisines)}`,
    ...allergyLines(profile.allergies).map((line) => `- Never (allergy): ${line}`),
    ...(diet && diet.id !== "none" ? [`- Diet (hard rule): ${diet.label}: ${diet.rule}`] : []),
    houseGoalLine(profile, people),
    `- Dislikes (avoid unless impossible): ${list(profile.dislikes)}`,
    `- Max prep + cook minutes per meal: ${profile.maxMinutesPerMeal}`,
    `- Weekly budget (estimated by the app): $${profile.weeklyBudgetUsd} USD`,
    `- Cooking skill: ${profile.skill}`,
    ...(kitchen
      ? [
          `- Kitchen (hard rule): has ${has.join(", ") || "nothing listed"}; does NOT have: ${lacks.join(", ") || "nothing missing"}. Never write a step that needs equipment the student does not have; list in equipment only tools they have. No oven → no bake/roast/broil; no stove → microwave, toaster or no-cook; no blender → chop or mash.`,
        ]
      : []),
    ...platesLines,
    ...(wantsLine ? [wantsLine] : []),
    ...(pets.length > 0
      ? [
          `- Pets: ${pets.map((p) => `${p.species} ${p.name}`).join(", ")}. When it fits, give each dinner one plain-shareable ingredient (chicken breast, turkey, salmon, eggs, white rice, sweet potato, carrot, pumpkin, oats) so a plain portion can be set aside before seasoning. Soft preference, never over the other rules.`,
        ]
      : []),
  ].join("\n");
}
