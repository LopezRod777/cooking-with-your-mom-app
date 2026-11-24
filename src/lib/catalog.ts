import catalogJson from "../../data/catalog.json";

export type CatalogItem = {
  key: string;
  displayName: string;
  aisle: string;
  package: { size: number; unit: string };
  usda: { fdcId: number; description: string; source: string } | null;
  per100g: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number | null;
  } | null;
  portions: { label: string; grams: number }[];
  allergens: string[];
  packageGrams?: number | null;
  proxyOf?: string;
};

// Allergen tags a catalog item can carry (data/allergens.json). Labels are for chips and prompts.
export const ALLERGEN_TAGS = [
  { id: "peanut", label: "Peanuts" },
  { id: "tree_nut", label: "Tree nuts" },
  { id: "dairy", label: "Dairy" },
  { id: "egg", label: "Eggs" },
  { id: "shellfish", label: "Shellfish" },
  { id: "fish", label: "Fish" },
  { id: "soy", label: "Soy" },
  { id: "wheat_gluten", label: "Wheat / Gluten" },
  { id: "sesame", label: "Sesame" },
  // Beyond the FDA nine: sensitivities people actually plan around (a friend, 2026-11-03). Same hard rule.
  { id: "nightshade", label: "Nightshades" },
  { id: "legume", label: "Legumes" },
  { id: "corn", label: "Corn" },
  { id: "onion_garlic", label: "Onion & garlic" },
] as const;

export type AllergenTag = (typeof ALLERGEN_TAGS)[number]["id"];

export const ALLERGEN_LABELS: Record<AllergenTag, string> = Object.fromEntries(
  ALLERGEN_TAGS.map((t) => [t.id, t.label]),
) as Record<AllergenTag, string>;

export function isAllergenTag(s: string): s is AllergenTag {
  return ALLERGEN_TAGS.some((t) => t.id === s);
}

const items: CatalogItem[] = catalogJson;

export const CATALOG: Record<string, CatalogItem> = {};
for (const item of items) {
  CATALOG[item.key] = item;
}

export const CATALOG_KEYS: string[] = Object.keys(CATALOG).sort();

export const AISLES: string[] = [
  "Produce",
  "Meat & Seafood",
  "Dairy & Eggs",
  "Deli",
  "Bakery & Bread",
  "Rice Pasta & Grains",
  "Breakfast & Cereal",
  "Canned & Jarred",
  "Frozen",
  "Pantry",
  "Baking",
  "Oils & Vinegars",
  "Condiments",
  "International",
  "Spices",
  "Snacks",
];

const EACH_PORTION_RE =
  /^1 (large|medium|each|whole|clove|head|bunch|slice|muffin|tortilla|piece|stalk|container|link|stick)\b/i;

export function packageGrams(item: CatalogItem): number | null {
  if (typeof item.packageGrams === "number") return item.packageGrams;
  const { size, unit } = item.package;
  switch (unit) {
    case "lb":
      return size * 453.592;
    case "oz":
      return size * 28.3495;
    case "fl oz":
      return size * 29.5735;
    case "each": {
      const portion = item.portions.find((p) => EACH_PORTION_RE.test(p.label));
      return portion ? size * portion.grams : null;
    }
    default:
      return null;
  }
}
