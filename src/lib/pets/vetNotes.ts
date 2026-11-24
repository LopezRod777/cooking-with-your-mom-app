import notesJson from "../../../data/pet-vet-notes.json";
import type { PetSpecies } from "./classify";

export type VetSource = { org: string; title: string; url: string; reviewer?: string };

export type VetNote = {
  ok: true | false | "caution";
  prep?: string;
  note?: string;
  source: VetSource;
};

export type VetRule = { text: string; sources: VetSource[] };

type RawSource = VetSource & { accessedAt: string; quote: string };
type RawNote = { ok: true | false | "caution"; prep?: string; note?: string; sourceId: string };
type RawRule = { rule: string; sourceIds: string[] };
type RawEmergency = { phone: string; url: string; fee?: string };

type VetJson = {
  foods: Record<string, Partial<Record<PetSpecies, RawNote>>>;
  sources: Record<string, RawSource>;
  emergency: { aspca: RawEmergency; pph: RawEmergency };
  rules: {
    treats10: Record<PetSpecies, RawRule>;
    largeBreed: RawRule;
    catsCarnivore: RawRule;
    fishCats: RawRule;
  };
};

const DATA = notesJson as unknown as VetJson;

function toSource(raw: RawSource): VetSource {
  return { org: raw.org, title: raw.title, url: raw.url, reviewer: raw.reviewer };
}

function sourcesFor(ids: string[]): VetSource[] {
  const out: VetSource[] = [];
  for (const id of ids) {
    if (!Object.hasOwn(DATA.sources, id)) continue;
    const s = toSource(DATA.sources[id]);
    if (!out.some((o) => o.org === s.org && o.url === s.url)) out.push(s);
  }
  return out;
}

// Returns the vet note for a food and species, or null when the JSON has no verified entry.
// Food ids in data/pet-vet-notes.json are the same ids as data/pet-foods.json, so no mapping is needed.
export function vetNoteFor(foodId: string, species: PetSpecies): VetNote | null {
  if (!Object.hasOwn(DATA.foods, foodId)) return null;
  const raw = DATA.foods[foodId][species];
  if (!raw || !Object.hasOwn(DATA.sources, raw.sourceId)) return null;
  return {
    ok: raw.ok,
    prep: raw.prep,
    note: raw.note,
    source: toSource(DATA.sources[raw.sourceId]),
  };
}

// Shortens the note so that "{note} ({org})" fits in `max` characters. Wording is never changed,
// only cut, and an ellipsis marks the cut.
export function fitNote(note: string, org: string, max = 160): string {
  const suffix = ` (${org})`;
  if (note.length + suffix.length <= max) return note;
  const room = max - suffix.length - 1;
  return `${note.slice(0, room).trimEnd()}…`;
}

// tel: link for a US number written as "(888) 426-4435".
export function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

export const EMERGENCY = {
  aspca: {
    phone: DATA.emergency.aspca.phone,
    url: DATA.emergency.aspca.url,
    fee: DATA.emergency.aspca.fee,
    org: DATA.sources.aspca_apc.org,
  },
  pph: {
    phone: DATA.emergency.pph.phone,
    url: DATA.emergency.pph.url,
    fee: DATA.emergency.pph.fee,
    org: DATA.sources.pph_home.org,
  },
};

export const VET_RULES = {
  treats10: {
    dog: { text: DATA.rules.treats10.dog.rule, sources: sourcesFor(DATA.rules.treats10.dog.sourceIds) },
    cat: { text: DATA.rules.treats10.cat.rule, sources: sourcesFor(DATA.rules.treats10.cat.sourceIds) },
  },
  largeBreed: {
    text: DATA.rules.largeBreed.rule,
    sources: sourcesFor(DATA.rules.largeBreed.sourceIds),
  },
  catsCarnivore: {
    text: DATA.rules.catsCarnivore.rule,
    sources: sourcesFor(DATA.rules.catsCarnivore.sourceIds),
  },
  fishCats: {
    text: DATA.rules.fishCats.rule,
    sources: sourcesFor(DATA.rules.fishCats.sourceIds),
  },
} satisfies Record<string, VetRule | Record<PetSpecies, VetRule>>;
