import { CATALOG } from "@/lib/catalog";
import { hazardSource, scanRecipe, type PetSpecies } from "@/lib/pets/classify";
import { shareableForPet } from "@/lib/pets/restrictions";
import type { Pet, Recipe } from "@/lib/schemas";

export const SPECIES_NOUN: Record<PetSpecies, string> = { dog: "dog", cat: "cat" };

export function nameOfKey(key: string): string {
  return (CATALOG[key]?.displayName ?? key.replace(/_/g, " ")).toLowerCase();
}

// "Rex", "Rex and Bella", "Rex, Bella and Milo".
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Hazard badges for a recipe, next to its title. The hazards of every species in the list, each named once.
export function HazardBadges({ recipe, species }: { recipe: Recipe; species: PetSpecies[] }) {
  const keys = [...new Set(species.flatMap((sp) => scanRecipe(recipe, sp).hazards))];
  return (
    <>
      {keys.map((key) => (
        <span
          key={key}
          className="ml-2 inline-block rounded-full bg-[#fde7e2] px-2 py-0.5 align-middle text-[13px] font-bold text-tomato"
        >
          {nameOfKey(key)}
        </span>
      ))}
    </>
  );
}

// Compact rows for one recipe and the pets of one species. "Could share" depends on each pet's restrictions;
// a medical or "other" restriction replaces it with a vet line. Hazards are shown as badges (HazardBadges).
// Empty rows are left out; no grams are computed here.
export function ScanRows({ recipe, pets }: { recipe: Recipe; pets: Pet[] }) {
  if (pets.length === 0) return null;
  const species = pets[0].species;
  const scan = scanRecipe(recipe, species);
  const hazard = scan.hazards.map(nameOfKey);

  // Pets with the same answer share one row.
  const groups = new Map<string, { names: string[]; vet: boolean; share: string[] }>();
  for (const pet of pets) {
    const res = shareableForPet(pet, recipe);
    const share = res.shareable.map(nameOfKey);
    const id = res.vet ? "vet" : share.join("|");
    const g = groups.get(id) ?? { names: [], vet: res.vet, share };
    g.names.push(pet.name);
    groups.set(id, g);
  }
  const rows = [...groups.values()].filter((g) => g.vet || g.share.length > 0);
  // One group: the rows read the same as for a single pet. More than one: name the pets.
  const single = groups.size === 1;

  // Only hazards carry a source; "not for pets" is Mama's default caution and says so.
  const sources = [...new Map(scan.hazards.map((k) => hazardSource(k)).filter((x) => x !== null).map((x) => [x.url, x])).values()];
  const sourceLine =
    sources.length > 0 ? (
      <li className="text-[15px] text-muted" data-testid="hazard-sources">
        Hazard source{sources.length > 1 ? "s" : ""}:{" "}
        {sources.map((src, i) => (
          <span key={src.url}>
            {i > 0 ? ", " : ""}
            <a href={src.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              {src.org}
            </a>
          </span>
        ))}
      </li>
    ) : null;

  if (rows.length === 0) {
    return hazard.length > 0 ? (sourceLine ? <ul className="grid gap-1.5 text-[17px] leading-snug">{sourceLine}</ul> : null) : <p className="text-[17px] text-muted">Nothing flagged for {SPECIES_NOUN[species]}s in this recipe.</p>;
  }
  return (
    <ul className="grid gap-1.5 text-[17px] leading-snug">
      {sourceLine}
      {rows.map((g) =>
        g.vet ? (
          <li key={g.names.join(",")}>Ask your vet before sharing anything with {joinNames(g.names)}.</li>
        ) : (
          <li key={g.names.join(",")}>
            {single ? "Could share" : `Could share with ${joinNames(g.names)}`}: {g.share.join(", ")}.
          </li>
        ),
      )}
    </ul>
  );
}
