import { DEFAULT_MEAL_TIMES } from "@/lib/mealTimes";
import type { MealTimes } from "@/lib/schemas";
import { ALLERGEN_LABELS, ALLERGEN_TAGS, isAllergenTag } from "@/lib/catalog";
import { isMinor, Profile, type Kitchen, type PetIntro, type Person } from "@/lib/schemas";
import { blankPerson, houseProteinG } from "@/lib/people";
import { KITCHEN_LABELS } from "@/components/kitchen/KitchenTiles";

export type Draft = {
  // Who's eating (onboarding step 2). Empty in Settings, which edits state.people directly.
  people: Person[];
  proteinTargetG: number;
  daysToPlan: 3 | 5 | 7 | null;
  slots: { breakfast: boolean; lunch: boolean; dinner: boolean; snack: boolean };
  mealTimes: MealTimes;
  servingsPerMeal: number;
  cuisines: string[];
  allergies: string[];
  dislikes: string[];
  diet: Profile["diet"];
  goal: Profile["goal"];
  maxMinutesPerMeal: number | null;
  weeklyBudgetUsd: number | null;
  skill: "beginner" | "comfortable" | null;
  kitchen: Kitchen | null;
  hasPets: boolean | null;
  cookForPets: boolean | null;
  petIntro: PetIntro | null;
  // Staged (uncommitted) photo version for petIntro; onboarding commits it on finish. Never stored.
  petPhotoDraft: string | null;
  drinkPairings: boolean | null;
  drinksBudgetUsd: number | null;
  mealDrinks: boolean;
};

export const CUISINES = [
  "Mexican",
  "Italian",
  "Mediterranean",
  "Japanese",
  "Chinese",
  "Korean",
  "Indian",
  "Thai",
  "American",
  "Greek",
];

// Each chip stores its trigger words. violatesAllergies matches by substring,
// so these must be lowercase words that appear in catalog display names.
export type AvoidOption = { label: string; terms: string[] };

// Allergy chips store the allergen tag id (e.g. "peanut"); violatesAllergies matches it on catalog tags.
export const ALLERGY_OPTIONS: AvoidOption[] = ALLERGEN_TAGS.map((t) => ({ label: t.label, terms: [t.id] }));

export const DISLIKE_OPTIONS: AvoidOption[] = [
  { label: "Onion", terms: ["onion"] },
  { label: "Mushrooms", terms: ["mushroom"] },
  { label: "Tomatoes", terms: ["tomato"] },
  { label: "Bell peppers", terms: ["bell pepper"] },
  { label: "Cilantro", terms: ["cilantro"] },
  { label: "Spicy food", terms: ["jalapeno", "chili", "chile", "sriracha", "hot sauce"] },
  { label: "Curry", terms: ["curry"] },
  { label: "Fish", terms: ["fish", "salmon", "tuna", "cod", "tilapia"] },
  { label: "Tofu", terms: ["tofu"] },
];

export const SLOT_LABELS = [
  ["breakfast", "Breakfast"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
  ["snack", "Snacks"],
] as const;

export function blankDraft(): Draft {
  return {
    people: [blankPerson("p1")],
    proteinTargetG: 120,
    daysToPlan: null,
    slots: { breakfast: false, lunch: false, dinner: false, snack: false },
    mealTimes: { ...DEFAULT_MEAL_TIMES },
    servingsPerMeal: 2,
    cuisines: [],
    allergies: [],
    dislikes: [],
    diet: "none",
    goal: "eat_well",
    maxMinutesPerMeal: null,
    weeklyBudgetUsd: null,
    skill: null,
    kitchen: null,
    hasPets: null,
    cookForPets: null,
    petIntro: null,
    petPhotoDraft: null,
    drinkPairings: null,
    drinksBudgetUsd: null,
    mealDrinks: false,
  };
}

export function profileToDraft(p: Profile): Draft {
  return {
    people: [],
    proteinTargetG: p.proteinTargetG,
    daysToPlan: p.daysToPlan,
    slots: { ...p.slots },
    mealTimes: { ...p.mealTimes },
    servingsPerMeal: p.servingsPerMeal,
    cuisines: [...p.cuisines],
    allergies: [...p.allergies],
    dislikes: [...p.dislikes],
    diet: p.diet,
    goal: p.goal,
    maxMinutesPerMeal: p.maxMinutesPerMeal,
    weeklyBudgetUsd: p.weeklyBudgetUsd,
    skill: p.skill,
    kitchen: p.kitchen,
    hasPets: p.hasPets,
    cookForPets: p.cookForPets,
    petIntro: p.petIntro,
    petPhotoDraft: null,
    drinkPairings: p.drinkPairings,
    drinksBudgetUsd: p.drinksBudgetUsd,
    mealDrinks: p.mealDrinks,
  };
}

export function draftToProfile(d: Draft, onboarded: boolean): Profile {
  // With people on the draft, the cooking yield is one serving per person, the protein target is the mean of
  // their estimates and the house goal is the first person's; the plain fields stay for Settings and older drafts.
  const people = d.people.filter((x) => x.name.trim() !== "" || x.sex !== null || x.weightKg !== null);
  return Profile.parse({
    version: 1,
    proteinTargetG: houseProteinG(d.people) ?? d.proteinTargetG,
    daysToPlan: d.daysToPlan ?? 5,
    slots: d.slots,
    mealTimes: { ...d.mealTimes },
    servingsPerMeal: d.people.length > 0 ? d.people.length : d.servingsPerMeal,
    cuisines: d.cuisines,
    allergies: d.allergies,
    dislikes: d.dislikes,
    diet: d.diet,
    // The house goal is the first grown-up's: a kid's "Eat to grow" sizes their plate, it does not steer the week.
    goal: people.find((x) => !isMinor(x))?.goal ?? (people.length > 0 ? "eat_well" : d.goal),
    maxMinutesPerMeal: d.maxMinutesPerMeal ?? 30,
    weeklyBudgetUsd: d.weeklyBudgetUsd ?? 100,
    skill: d.skill ?? "beginner",
    kitchen: d.kitchen,
    hasPets: d.hasPets,
    cookForPets: d.hasPets === true ? d.cookForPets : null,
    petIntro: d.hasPets === true && d.cookForPets === true ? d.petIntro : null,
    drinkPairings: d.drinkPairings,
    drinksBudgetUsd: d.drinkPairings === true ? d.drinksBudgetUsd : null,
    mealDrinks: d.mealDrinks,
    onboarded,
  });
}

export function hasMeal(d: Draft): boolean {
  return Object.values(d.slots).some(Boolean);
}

export function groupSelected(terms: string[], list: string[]): boolean {
  return terms.every((t) => list.includes(t));
}

export function toggleGroup(terms: string[], list: string[]): string[] {
  if (groupSelected(terms, list)) return list.filter((x) => !terms.includes(x));
  return [...list, ...terms.filter((t) => !list.includes(t))];
}

export function customTerms(options: AvoidOption[], list: string[]): string[] {
  const known = new Set(options.flatMap((o) => o.terms));
  return list.filter((x) => !known.has(x));
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Chips show their label; free text is shown as typed.
export function allergyLabel(a: string): string {
  return isAllergenTag(a) ? ALLERGEN_LABELS[a] : a;
}

export function summarize(d: Draft, locationLabel: string): string[] {
  const meals = SLOT_LABELS.filter(([k]) => d.slots[k]).map(([, l]) => l.toLowerCase());
  const lines = [
    `Cooking in ${locationLabel} for ${d.people.length || d.servingsPerMeal} ${(d.people.length || d.servingsPerMeal) === 1 ? "person" : "people"}.`,
    `Planning ${d.daysToPlan ?? 5} days of ${joinList(meals)}, aiming for ${d.proteinTargetG} g of protein a day.`,
    d.cuisines.length
      ? `Favorite cuisines: ${joinList(d.cuisines)}.`
      : "No cuisine favorites yet, so Mama keeps the menu open.",
    d.allergies.length
      ? `Never: ${joinList(d.allergies.map(allergyLabel))}. These are hard rules.`
      : "Nothing is off-limits.",
  ];
  if (d.dislikes.length) lines.push(`Rather not: ${joinList(d.dislikes)}.`);
  lines.push(
    `Meals under ${d.maxMinutesPerMeal ?? 30} minutes, on about $${d.weeklyBudgetUsd ?? 100} a week.`,
  );
  if (d.kitchen) {
    const have = Object.entries(d.kitchen)
      .filter(([, on]) => on)
      .map(([tool]) => KITCHEN_LABELS[tool as keyof typeof KITCHEN_LABELS]);
    lines.push(`Cooking with: ${have.join(", ")}.`);
  }
  if (d.hasPets && d.cookForPets) {
    const who = d.petIntro?.name?.trim() || "your pet";
    lines.push(`A plain plate set aside for ${who} when a recipe allows it.`);
  }
  if (d.drinkPairings) {
    lines.push(
      d.drinksBudgetUsd === null
        ? "Drink pairings with your meals."
        : `Drink pairings with your meals, on about $${d.drinksBudgetUsd} a week.`,
    );
  }
  lines.push(
    d.skill === "comfortable"
      ? "You manage in the kitchen, so the steps can be quicker."
      : "You are still learning, so Mama keeps the steps simple.",
  );
  return lines;
}
