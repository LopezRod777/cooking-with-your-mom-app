import classificationJson from "../../../data/pet-classification.json";
import sourcesJson from "../../../data/pet-hazard-sources.json";

export type PetSpecies = "dog" | "cat";
export type PetClass = "hazard" | "not_for_pets" | "shareable_if_plain";

export type HazardSource = {
  title: string;
  org: string;
  url: string;
  accessedAt: string;
  quote: string;
  covers: string[];
};

type ClassEntry = {
  dog: PetClass;
  cat: PetClass;
  sourceId?: string;
  note?: string;
};

const KEYS = (classificationJson as unknown as { keys: Record<string, ClassEntry> }).keys;
const SOURCES = sourcesJson as unknown as Record<string, HazardSource>;

function entryFor(key: string): ClassEntry | undefined {
  return Object.prototype.hasOwnProperty.call(KEYS, key) ? KEYS[key] : undefined;
}

export function classify(key: string, species: PetSpecies): PetClass {
  const entry = entryFor(key);
  return entry ? entry[species] : "not_for_pets";
}

export function hazardSource(key: string): HazardSource | null {
  const entry = entryFor(key);
  if (!entry?.sourceId) return null;
  return SOURCES[entry.sourceId] ?? null;
}

export function scanRecipe(
  recipe: { ingredients: { key: string; display?: string }[] },
  species: PetSpecies,
): { hazards: string[]; notForPets: string[]; shareable: string[] } {
  const seen = new Set<string>();
  const out = { hazards: [] as string[], notForPets: [] as string[], shareable: [] as string[] };
  for (const { key } of recipe.ingredients) {
    if (seen.has(key)) continue;
    seen.add(key);
    const cls = classify(key, species);
    if (cls === "hazard") out.hazards.push(key);
    else if (cls === "shareable_if_plain") out.shareable.push(key);
    else out.notForPets.push(key);
  }
  return out;
}
