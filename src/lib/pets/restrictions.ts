import restrictionsJson from "../../../data/pet-restrictions.json";
import type { Pet, Restriction } from "../schemas";
import { foodsFor, type PetFood } from "./foods";
import { scanRecipe } from "./classify";

// Deterministic restriction rules. Allergens exclude foods (and bowls that contain them).
// Medical and "other" restrictions block the extras list and bowls entirely.

export type RestrictionSource = { org: string; url: string; quote: string; accessedAt: string };

type Medical = {
  block: boolean;
  text?: string;
  template?: string;
  sourceId: string | null;
  catSourceId?: string;
  ourRule?: boolean;
};

const DATA = restrictionsJson as unknown as {
  allergens: Record<string, string[]>;
  medical: Record<string, Medical>;
  sources: Record<string, RestrictionSource>;
};

export type Blocked = { text: string; source: RestrictionSource | null };

function displayText(r: Restriction): string | null {
  const m = DATA.medical[r.kind];
  if (!m || !m.block) return null;
  if (m.template) return m.template.replace("{text}", r.text?.trim() || "a restriction you added");
  return m.text ?? null;
}

// First medical/other restriction in the pet's list, with its source (cats use the cat source where one is given).
export function blockedInfo(pet: Pet): Blocked | null {
  for (const r of pet.restrictions) {
    const text = displayText(r);
    if (text === null) continue;
    const m = DATA.medical[r.kind];
    const id = pet.species === "cat" && m.catSourceId ? m.catSourceId : m.sourceId;
    return { text, source: id ? (DATA.sources[id] ?? null) : null };
  }
  return null;
}

export function blockedReason(pet: Pet): string | null {
  return blockedInfo(pet)?.text ?? null;
}

export function excludedFoodIds(pet: Pet): Set<string> {
  const out = new Set<string>();
  for (const r of pet.restrictions) {
    for (const id of DATA.allergens[r.kind] ?? []) out.add(id);
  }
  return out;
}

export function allowedFoods(pet: Pet): PetFood[] {
  if (blockedReason(pet) !== null) return [];
  const excluded = excludedFoodIds(pet);
  return foodsFor(pet.species).filter((f) => !excluded.has(f.id));
}

export function foodAllowed(pet: Pet, foodId: string): boolean {
  return allowedFoods(pet).some((f) => f.id === foodId);
}

// Catalog keys are not pet foods (beef, eggs, dairy have no food id), so each key is matched to an
// allergen kind by its words: "chicken_breast" -> chicken, "eggs" -> egg, "rolled_oats" -> grain.
const ALLERGEN_WORDS: Record<string, string[]> = {
  chicken: ["chicken"],
  turkey: ["turkey"],
  beef: ["beef"],
  fish: ["salmon", "tuna", "cod", "shrimp", "fish", "tilapia"],
  egg: ["egg", "eggs"],
  grain: ["rice", "oats", "oat", "pasta", "bread", "flour", "quinoa"],
  dairy: ["milk", "cheese", "yogurt", "butter"],
};

export function allergenOfKey(key: string): string | null {
  const words = key.split("_");
  for (const [kind, list] of Object.entries(ALLERGEN_WORDS)) {
    if (words.some((w) => list.includes(w))) return kind;
  }
  return null;
}

export type PetShare = { shareable: string[]; vet: boolean };

// What one pet may get from a recipe, plain. Allergen keys drop out for that pet; a medical or "other"
// restriction blocks sharing entirely (vet: true). Hazard and not-for-pets lines are not handled here.
export function shareableForPet(pet: Pet, recipe: { ingredients: { key: string }[] }): PetShare {
  if (blockedReason(pet) !== null) return { shareable: [], vet: true };
  const allergenKinds = new Set<string>(pet.restrictions.map((r) => r.kind));
  const shareable = scanRecipe(recipe, pet.species).shareable.filter((key) => {
    const kind = allergenOfKey(key);
    return kind === null || !allergenKinds.has(kind);
  });
  return { shareable, vet: false };
}
