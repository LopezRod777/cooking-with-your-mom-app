import sipsJson from "../../../data/pet-sips.json";
import type { PetSpecies } from "./classify";
import type { VetSource } from "./vetNotes";

// "Sips": safe drinks and frozen treats for a dog or cat. Informational, from vet sources fetched and quoted in
// data/pet-sips.json. They are treats, not hydration plans; the rules below travel with the list.
export type Sip = { id: string; species: PetSpecies[]; name: string; how: string; note?: string; sources: VetSource[] };
export type SipRule = { text: string; sources: VetSource[] };

type RawSource = VetSource & { accessedAt: string; quote: string };
type RawSip = { id: string; species: PetSpecies[]; name: string; how: string; note?: string; sourceIds: string[] };
type RawRule = { text: string; sourceIds: string[] };
type SipsJson = { sources: Record<string, RawSource>; rules: Record<"treat" | "never" | "catsMilk", RawRule>; sips: RawSip[] };

const DATA = sipsJson as unknown as SipsJson;

function sourcesFor(ids: string[]): VetSource[] {
  const out: VetSource[] = [];
  for (const id of ids) {
    if (!Object.hasOwn(DATA.sources, id)) continue;
    const { org, title, url } = DATA.sources[id];
    if (!out.some((o) => o.url === url)) out.push({ org, title, url });
  }
  return out;
}

export const SIPS: Sip[] = DATA.sips.map(({ sourceIds, ...s }) => ({ ...s, sources: sourcesFor(sourceIds) }));

export function sipsFor(species: PetSpecies): Sip[] {
  return SIPS.filter((s) => s.species.includes(species));
}

// Rules shown under the list: the treat rule for everyone, "never" for everyone, the milk rule for cats.
export function sipRulesFor(species: PetSpecies): SipRule[] {
  const keys: ("treat" | "never" | "catsMilk")[] = species === "cat" ? ["treat", "never", "catsMilk"] : ["treat", "never"];
  return keys.map((k) => ({ text: DATA.rules[k].text, sources: sourcesFor(DATA.rules[k].sourceIds) }));
}
