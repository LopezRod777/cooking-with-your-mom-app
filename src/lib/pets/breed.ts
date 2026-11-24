import breedsJson from "../../../data/pet-breeds.json";
import type { Pet } from "../schemas";
import type { VetSource } from "./vetNotes";
import { ageMonths, dailyKcal, stage } from "./energy";

export type BreedCertainty = "exact" | "mix" | "uncertain";
export type BreedMatch = { breedId: string; certainty: BreedCertainty };
// breedId is the first breed that contributed; breedIds lists every matched breed sharing the condition (a Lab + Doberman mix: one copper note for both).
export type BreedNote = { breedId: string; breedIds: string[]; conditionId: string; title: string; text: string; sources: VetSource[] };

type RawBreed = {
  label: string;
  plural: string;
  aliases: string[];
  mixAliases: string[];
  uncertainAliases?: string[];
  conditionIds: string[];
};
type RawCondition = {
  title: string;
  text: string;
  sourceIds: string[];
  stages?: string[];
  requiresSize?: "small" | "medium" | "large";
};
type RawSource = VetSource & { accessedAt: string; quote: string };
type BreedData = {
  breeds: Record<string, RawBreed>;
  mixWords: string[];
  conditions: Record<string, RawCondition>;
  sources: Record<string, RawSource>;
};

const DATA = breedsJson as unknown as BreedData;

export function normalizeBreedText(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 0);
}

type AliasEntry = { breedId: string; alias: string; words: string[]; mix: boolean; uncertain: boolean };

// Longest word sequence first, so "west highland white terrier" beats "westie" style overlaps.
const ALIASES: AliasEntry[] = Object.entries(DATA.breeds)
  .flatMap(([breedId, b]) =>
    b.aliases.map((alias) => ({
      breedId,
      alias,
      words: normalizeBreedText(alias),
      mix: b.mixAliases.includes(alias),
      uncertain: (b.uncertainAliases ?? []).includes(alias),
    })),
  )
  .sort((a, b) => b.words.length - a.words.length || b.alias.length - a.alias.length);

export function matchBreed(text: string | undefined | null): BreedMatch[] {
  if (!text) return [];
  const words = normalizeBreedText(text);
  if (words.length === 0) return [];

  const consumed = new Array<boolean>(words.length).fill(false);
  const seen = new Set<string>();
  const found: { breedId: string; pos: number; mix: boolean; uncertain: boolean }[] = [];

  for (const a of ALIASES) {
    const n = a.words.length;
    for (let i = 0; i + n <= words.length; i++) {
      let ok = true;
      for (let j = 0; j < n; j++) {
        if (consumed[i + j] || words[i + j] !== a.words[j]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let j = 0; j < n; j++) consumed[i + j] = true;
      if (!seen.has(a.breedId)) {
        seen.add(a.breedId);
        found.push({ breedId: a.breedId, pos: i, mix: a.mix, uncertain: a.uncertain });
      }
      break;
    }
  }

  const isMix = words.some((w) => DATA.mixWords.includes(w)) || found.some((f) => f.mix) || found.length >= 2;

  return found
    .sort((a, b) => a.pos - b.pos)
    .slice(0, 2)
    .map((f) => ({
      breedId: f.breedId,
      certainty: (f.uncertain ? "uncertain" : isMix ? "mix" : "exact") as BreedCertainty,
    }));
}

export function breedLabel(breedId: string): { label: string; plural: string } {
  const b = DATA.breeds[breedId];
  return { label: b.label, plural: b.plural };
}

function ageText(months: number): string {
  if (months < 12) return `about ${months} ${months === 1 ? "month" : "months"} old`;
  const years = Math.floor(months / 12);
  return `about ${years} ${years === 1 ? "year" : "years"} old`;
}

// Single pass, so a substituted value (for example a pet name) is never re-read as a placeholder.
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? values[key] : whole));
}

function joinWords(xs: string[], sep: "and" | "or"): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} ${sep} ${xs[xs.length - 1]}`;
}

export function breedNotes(pet: Pet, now: Date): BreedNote[] {
  if (pet.species !== "dog") return [];
  const matches = matchBreed(pet.breed);
  if (matches.length === 0) return [];

  const st = stage(pet, now);
  const { mer } = dailyKcal(pet, now);
  const months = ageMonths(pet.bornYearMonth, now);

  // One note per condition; every matched breed that carries the condition is named in it.
  const byCondition = new Map<string, BreedMatch[]>();
  for (const match of matches) {
    for (const conditionId of DATA.breeds[match.breedId].conditionIds) {
      const c = DATA.conditions[conditionId];
      if (c.stages && !c.stages.includes(st)) continue;
      if (c.requiresSize && pet.expectedAdultSize !== c.requiresSize) continue;
      const list = byCondition.get(conditionId) ?? [];
      list.push(match);
      byCondition.set(conditionId, list);
    }
  }

  const notes: BreedNote[] = [];
  for (const [conditionId, contributors] of byCondition) {
    const c = DATA.conditions[conditionId];
    const breeds = contributors.map((m) => DATA.breeds[m.breedId]);
    const values: Record<string, string> = {
      Plural: joinWords(breeds.map((b) => b.plural), "and"),
      label: breeds[0].label,
      name: pet.name,
      lb: String(Math.round(pet.weightKg * 2.2046)),
      ageText: ageText(months),
      monthsText: `about ${months} ${months === 1 ? "month" : "months"} old`,
      kcalClause: typeof mer === "number" ? `, eating about ${Math.round(mer)} kcal a day` : "",
    };

    let text = fill(c.text, values);
    const certainty = contributors[0].certainty;
    const labels = joinWords(breeds.map((b) => b.label), "or");
    if (certainty === "uncertain") text = `If ${pet.name} is a ${labels}: ${text}`;
    else if (certainty === "mix" || contributors.length > 1) text = `If ${pet.name} is part ${labels}: ${text}`;

    notes.push({
      breedId: contributors[0].breedId,
      breedIds: contributors.map((m) => m.breedId),
      conditionId,
      title: fill(c.title, values),
      text,
      sources: c.sourceIds
        .filter((id) => Object.hasOwn(DATA.sources, id))
        .map((id) => {
          const src = DATA.sources[id];
          return { org: src.org, title: src.title, url: src.url };
        }),
    });
  }
  return notes;
}

export function breedHeading(notes: BreedNote[]): string {
  const plurals: string[] = [];
  for (const id of notes.flatMap((n) => n.breedIds)) {
    const p = breedLabel(id).plural;
    if (!plurals.includes(p)) plurals.push(p);
  }
  if (plurals.length === 0) return "";
  if (plurals.length === 1) return `About ${plurals[0]}`;
  return `About ${plurals.slice(0, -1).join(", ")} and ${plurals[plurals.length - 1]}`;
}
