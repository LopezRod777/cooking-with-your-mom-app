import { ALLERGEN_LABELS, AISLES, CATALOG, isAllergenTag, packageGrams, type AllergenTag } from "./catalog";
import type { Profile, Recipe, WeekPlan } from "./schemas";

export type GroceryItem = {
  key: string;
  displayName: string;
  gramsNeeded: number;
  packages: number | null;
  packageLabel: string;
  estCostUsd: number | null;
};

export type GroceryList = {
  aisles: { aisle: string; items: GroceryItem[] }[];
  totals: { estCostUsd: number | null; itemCount: number; pricedItemCount: number };
};

export type BuildGroceryOpts = {
  haveAtHome: string[];
  prices?: Record<string, number>;
  // profile.mealDrinks. Off: the plan's drinks are left off the list (the screens hide them too).
  mealDrinks: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildGroceryList(plan: WeekPlan, opts: BuildGroceryOpts): GroceryList {
  const need = new Map<string, number>();

  for (const day of plan.days) {
    for (const meal of day.meals) {
      const recipe = plan.recipes[meal.recipeId];
      if (!recipe) continue;
      const factor = meal.servings / recipe.servings;
      for (const ing of recipe.ingredients) {
        need.set(ing.key, (need.get(ing.key) ?? 0) + ing.grams * factor);
      }
      // The meal's drink lists grams for the meal's servings already.
      if (opts.mealDrinks) {
        for (const ing of meal.drink?.ingredients ?? []) {
          need.set(ing.key, (need.get(ing.key) ?? 0) + ing.grams);
        }
      }
    }
  }

  const have = new Set(opts.haveAtHome);
  const byAisle = new Map<string, GroceryItem[]>();
  let estTotal: number | null = null;
  let itemCount = 0;
  let pricedItemCount = 0;

  for (const [key, rawGrams] of need) {
    const item = CATALOG[key];
    if (!item || have.has(key)) continue;

    const gramsNeeded = round1(rawGrams);
    const pkgG = packageGrams(item);
    const packages = pkgG ? Math.ceil(gramsNeeded / pkgG) : null;
    const price = opts.prices?.[key];
    const estCostUsd =
      packages !== null && typeof price === "number" ? round2(packages * price) : null;

    const grocery: GroceryItem = {
      key,
      displayName: item.displayName,
      gramsNeeded,
      packages,
      packageLabel: `${item.package.size} ${item.package.unit}`,
      estCostUsd,
    };

    itemCount += 1;
    if (estCostUsd !== null) {
      pricedItemCount += 1;
      estTotal = round2((estTotal ?? 0) + estCostUsd);
    }

    const list = byAisle.get(item.aisle) ?? [];
    list.push(grocery);
    byAisle.set(item.aisle, list);
  }

  const aisles = AISLES.filter((a) => byAisle.has(a)).map((aisle) => ({
    aisle,
    items: (byAisle.get(aisle) ?? []).sort((a, b) => a.displayName.localeCompare(b.displayName)),
  }));

  return { aisles, totals: { estCostUsd: estTotal, itemCount, pricedItemCount } };
}

// Pantry basics most kitchens already have. The shopping list offers them as "Already at home?" chips and the counts
// show them apart, so a long list reads as "41 things, plus 13 basics" instead of "54 things to buy".
export const PANTRY_BASICS = [
  "olive_oil", "salt", "black_pepper", "garlic_powder", "soy_sauce", "rice",
  "white_rice", "brown_rice", "eggs", "butter", "flour", "honey", "cumin",
  "onion_powder", "paprika", "cinnamon", "vinegar_balsamic", "sesame_oil",
  "hot_sauce", "mustard", "mayo", "ketchup", "chili_powder", "italian_seasoning",
  "oregano", "vegetable_oil", "sugar", "milk", "garlic", "lemon",
];
const BASICS_SET = new Set(PANTRY_BASICS);

export function isPantryBasic(key: string): boolean {
  return BASICS_SET.has(key);
}

// Items on the list that are not pantry basics, and the basics, as counts.
export function splitBasics(list: GroceryList): { toBuy: number; basics: number } {
  let basics = 0;
  for (const aisle of list.aisles) for (const item of aisle.items) if (BASICS_SET.has(item.key)) basics += 1;
  return { toBuy: list.totals.itemCount - basics, basics };
}

// Cost of the grams one recipe uses at `servings`, priced by its share of each package (no whole-package
// rounding). Same grams and packageGrams derivation as buildGroceryList. Null when the recipe has no
// ingredients, or any ingredient lacks a catalog packageGrams or a price.
export function proportionalCostUsd(
  recipe: Pick<Recipe, "servings" | "ingredients">,
  servings: number,
  prices: Record<string, number>,
): number | null {
  const factor = servings / recipe.servings;
  const need = new Map<string, number>();
  for (const ing of recipe.ingredients) {
    need.set(ing.key, (need.get(ing.key) ?? 0) + ing.grams * factor);
  }
  if (need.size === 0) return null;

  let total = 0;
  for (const [key, rawGrams] of need) {
    const item = CATALOG[key];
    const pkgG = item ? packageGrams(item) : null;
    const price = prices[key];
    if (!item || !pkgG || typeof price !== "number") return null;
    total += (round1(rawGrams) / pkgG) * price;
  }
  return total;
}

export function planCost(
  plan: WeekPlan,
  prices: Record<string, number>,
  mealDrinks: boolean,
): { totalUsd: number | null; perServingUsd: number | null } {
  const list = buildGroceryList(plan, { haveAtHome: [], prices, mealDrinks });
  const totalUsd = list.totals.estCostUsd;
  const servings = plan.days.reduce(
    (sum, day) => sum + day.meals.reduce((s, m) => s + m.servings, 0),
    0,
  );
  const perServingUsd = totalUsd !== null && servings > 0 ? round2(totalUsd / servings) : null;
  return { totalUsd, perServingUsd };
}

// An allergy entry is either an allergen tag (matched on the catalog's `allergens`)
// or free text (matched on the ingredient key, its catalog display name, and the recipe's display line).
export function violatesAllergies(
  recipe: { ingredients: { key: string; display?: string }[] },
  allergies: string[],
): boolean {
  const entries = allergies.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0);
  if (entries.length === 0) return false;
  const tags: string[] = entries.filter((a) => isAllergenTag(a));
  const terms = entries.filter((a) => !isAllergenTag(a));
  const nameTerms = terms.filter((a) => a.length >= 3);

  return recipe.ingredients.some((ing) => {
    const key = ing.key.toLowerCase();
    if (CATALOG[ing.key]?.allergens.some((t) => tags.includes(t))) return true;
    if (terms.includes(key)) return true;
    const name = (CATALOG[ing.key]?.displayName ?? "").toLowerCase();
    const display = (ing.display ?? "").toLowerCase();
    return nameTerms.some((a) => name.includes(a) || display.includes(a));
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Lowercased catalog name without parentheticals: "Peanuts (roasted)" -> "peanuts".
const plainName = (s: string) => s.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
// Whole word, optional plural: "peanuts" matches "peanut" and "peanuts"; "walnuts" matches "walnut".
const wordRe = (w: string, flags = "iu") =>
  new RegExp(`(?<!\\p{L})${escapeRe(w.replace(/s$/, ""))}s?(?!\\p{L})`, flags);

// Free text (steps, momTip, notes, ideas) that names an allergen. Whole words, case-insensitive.
// A tag matches its label words ("Wheat / Gluten" -> wheat, gluten) and the catalog names of its items; a typed
// allergy (3+ letters) matches as typed and also any catalog name that contains it. Catalog names are checked
// longest first and masked once checked, so "butter" inside "peanut butter" is not a dairy mention and
// "milk" inside "almond milk" is not a dairy mention.
export function textMentionsAllergen(text: string, allergies: string[]): boolean {
  const entries = allergies.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0);
  const tags = entries.filter((a): a is AllergenTag => isAllergenTag(a));
  const terms = entries.filter((a) => !isAllergenTag(a) && a.length >= 3);
  if (tags.length === 0 && terms.length === 0) return false;

  // Each item contributes its display name and its key ("cheddar" for "Cheddar cheese (shredded)").
  const names = Object.values(CATALOG)
    .flatMap((i) => {
      const covered =
        i.allergens.some((t) => tags.includes(t as AllergenTag)) ||
        terms.some((t) => plainName(i.displayName).includes(t));
      return [...new Set([plainName(i.displayName), i.key.replace(/_/g, " ")])].map((name) => ({ name, covered }));
    })
    .filter((n) => n.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);

  let haystack = text.toLowerCase();
  for (const { name, covered } of names) {
    const re = wordRe(name, "giu");
    if (covered && re.test(haystack)) return true;
    haystack = haystack.replace(re, " ");
  }

  const labelWords = tags.flatMap((t) => ALLERGEN_LABELS[t].split("/").map((l) => plainName(l)));
  return [...labelWords, ...terms].some((w) => wordRe(w).test(haystack));
}

// Catalog gaps for the diet rules. The catalog has allergen tags but no meat, poultry, pork, honey or alcohol tags,
// so these keys are listed by hand. Meat is the "Meat & Seafood" aisle minus fish and shellfish, plus these.
const DIET_GAP_POULTRY_KEYS = ["deli_turkey", "chicken_broth"];
const DIET_GAP_ANIMAL_KEYS = ["honey"];

const hasTag = (key: string, tag: string) => CATALOG[key]?.allergens.includes(tag) ?? false;
const isFishKey = (key: string) => hasTag(key, "fish") || hasTag(key, "shellfish");
const MEAT_KEYS = new Set([
  ...Object.values(CATALOG)
    .filter((i) => i.aisle === "Meat & Seafood" && !isFishKey(i.key))
    .map((i) => i.key),
  ...DIET_GAP_POULTRY_KEYS,
]);
const PORK_KEYS = new Set(Object.values(CATALOG).filter((i) => /\bpork\b/i.test(i.displayName)).map((i) => i.key));

// Carnivore: only animal foods plus salt. Catalog aisles and allergen tags decide; the gaps are listed by hand.
const ANIMAL_KEYS = new Set([
  ...MEAT_KEYS,
  ...Object.values(CATALOG)
    .filter((i) => isFishKey(i.key) || hasTag(i.key, "dairy") || hasTag(i.key, "egg"))
    .map((i) => i.key),
  "salt",
]);
// Dairy-tagged keys that are not dairy foods on a carnivore or paleo plate (almond milk carries the tag for labeling only).
const PLANT_WITH_DAIRY_TAG = new Set(["almond_milk"]);
const isAnimalKey = (key: string) => ANIMAL_KEYS.has(key) && !PLANT_WITH_DAIRY_TAG.has(key);

// Keto: grains, starches, sugars, legumes and sugary fruit are out. Aisles first, then keys the aisle rule misses.
const GRAIN_AISLES = new Set(["Rice Pasta & Grains", "Bakery & Bread", "Breakfast & Cereal"]);
const KETO_BANNED = new Set([
  ...Object.values(CATALOG).filter((i) => GRAIN_AISLES.has(i.aisle)).map((i) => i.key),
  "potatoes", "sweet_potatoes", "corn_frozen", "corn_tortillas", "peas_frozen",
  "sugar", "brown_sugar", "honey", "maple_syrup", "flour", "cornstarch", "breadcrumbs",
  "black_beans", "kidney_beans", "pinto_beans", "chickpeas", "hummus",
  "banana", "apple", "orange", "grapes", "mango_frozen", "pineapple_frozen", "dates_medjool",
  "ketchup", "bbq_sauce", "granola", "rice_cakes", "popcorn_kernels", "dark_chocolate",
]);
// Paleo: no grains, legumes, dairy, refined sugar or seed oils.
const PALEO_BANNED = new Set([
  ...Object.values(CATALOG).filter((i) => GRAIN_AISLES.has(i.aisle) || (hasTag(i.key, "dairy") && !PLANT_WITH_DAIRY_TAG.has(i.key))).map((i) => i.key),
  "black_beans", "kidney_beans", "pinto_beans", "chickpeas", "hummus", "edamame", "tofu_firm", "soy_sauce",
  "peanuts", "peanut_butter", "sugar", "brown_sugar", "flour", "cornstarch", "breadcrumbs", "corn_frozen", "corn_tortillas",
  "vegetable_oil", "ketchup", "bbq_sauce", "rice_cakes", "popcorn_kernels", "protein_powder_whey",
]);

// Hard diet rule on the ingredients. "none" never violates. Halal and kosher meat sourcing and halal alcohol cannot be
// read from the catalog, so they are not checked here.
export function violatesDiet(recipe: { ingredients: { key: string }[] }, diet: Profile["diet"]): boolean {
  if (diet === "none") return false;
  const keys = recipe.ingredients.map((i) => i.key);
  const meat = keys.some((k) => MEAT_KEYS.has(k));
  const pork = keys.some((k) => PORK_KEYS.has(k));
  const fish = keys.some((k) => hasTag(k, "fish"));
  const shellfish = keys.some((k) => hasTag(k, "shellfish"));
  const dairy = keys.some((k) => hasTag(k, "dairy"));
  const egg = keys.some((k) => hasTag(k, "egg"));
  const honey = keys.some((k) => DIET_GAP_ANIMAL_KEYS.includes(k));

  switch (diet) {
    case "vegetarian":
      return meat || fish || shellfish;
    case "pescatarian":
      return meat;
    case "vegan":
      return meat || fish || shellfish || dairy || egg || honey;
    case "kosher":
      return pork || shellfish || (meat && dairy);
    case "halal":
      return pork;
    case "carnivore":
      return keys.some((k) => !isAnimalKey(k));
    case "keto":
      return keys.some((k) => KETO_BANNED.has(k));
    case "paleo":
      return keys.some((k) => PALEO_BANNED.has(k));
    case "mediterranean":
      // A pattern, not a ban list: the prompt carries it; nothing is rejected here.
      return false;
  }
}

// Recipes in the plan whose ingredients break the profile's diet. Empty for "none". The plan builder swaps these when
// it can; whatever is left is shown, never hidden.
export function dietBreaks(plan: WeekPlan, diet: Profile["diet"]): Recipe[] {
  if (diet === "none") return [];
  return Object.values(plan.recipes).filter((r) => violatesDiet(r, diet));
}
