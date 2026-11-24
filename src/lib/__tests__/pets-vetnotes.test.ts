import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EMERGENCY, VET_RULES, fitNote, telHref, vetNoteFor } from "../pets/vetNotes";
import { PET_FOODS } from "../pets/foods";

const json = JSON.parse(readFileSync(resolve(__dirname, "../../../data/pet-vet-notes.json"), "utf8")) as {
  foods: Record<string, Record<string, { note?: string; sourceId: string }>>;
  sources: Record<string, { url: string; org: string }>;
  emergency: { aspca: { phone: string }; pph: { phone: string } };
  status: string;
};

describe("emergency lines", () => {
  it("ASPCA phone matches the JSON and the verified number", () => {
    expect(EMERGENCY.aspca.phone).toBe(json.emergency.aspca.phone);
    expect(EMERGENCY.aspca.phone).toBe("(888) 426-4435");
  });

  it("Pet Poison Helpline phone matches the JSON and the verified number", () => {
    expect(EMERGENCY.pph.phone).toBe(json.emergency.pph.phone);
    expect(EMERGENCY.pph.phone).toBe("(855) 764-7661");
  });

  it("tel links use E.164 digits", () => {
    expect(telHref(EMERGENCY.aspca.phone)).toBe("tel:+18884264435");
    expect(telHref(EMERGENCY.pph.phone)).toBe("tel:+18557647661");
  });
});

describe("vet notes", () => {
  it("every food note has a source with an https url", () => {
    let checked = 0;
    for (const [foodId, bySpecies] of Object.entries(json.foods)) {
      for (const [species, entry] of Object.entries(bySpecies)) {
        const note = vetNoteFor(foodId, species as "dog" | "cat");
        expect(note, `${foodId}.${species}`).not.toBeNull();
        expect(note!.source.url.startsWith("https://"), `${foodId}.${species} url`).toBe(true);
        expect(note!.source.url).toBe(json.sources[entry.sourceId].url);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("no displayed note contains research-process wording", () => {
    for (const foodId of Object.keys(json.foods)) {
      for (const species of ["dog", "cat"] as const) {
        const note = vetNoteFor(foodId, species)?.note ?? "";
        expect(note, `${foodId}.${species}`).not.toMatch(/NOT FOUND|in this run|keep them out/);
      }
    }
  });

  it("the JSON is marked as a verified subset", () => {
    expect(json.status).toBe("verified-subset");
  });

  it("a food with no verified entry for a species returns null", () => {
    expect(vetNoteFor("white_rice_cooked", "cat")).toBeNull();
    expect(vetNoteFor("chicken_breast_cooked", "cat")).toBeNull();
    expect(vetNoteFor("no_such_food", "dog")).toBeNull();
  });

  it("every pet-foods id that has a vet note resolves to a real food", () => {
    const ids = new Set(PET_FOODS.map((f) => f.id));
    const withNotes = Object.keys(json.foods).filter((id) => ids.has(id));
    expect(withNotes.length).toBeGreaterThan(0);
  });

  it("chicken breast for dog is sourced to Tufts", () => {
    const v = vetNoteFor("chicken_breast_cooked", "dog");
    expect(v?.ok).toBe("caution");
    expect(v?.source.org).toBe("Tufts Cummings School, Petfoodology");
  });
});

describe("line length", () => {
  it("a long note is cut so the whole line is at most 160 characters", () => {
    const org = "Tufts Cummings School, Petfoodology";
    const note = "word ".repeat(80).trim();
    const fitted = fitNote(note, org);
    const line = `${fitted} (${org})`;
    expect(line.length).toBeLessThanOrEqual(160);
    expect(fitted.endsWith("…")).toBe(true);
    expect(note.startsWith(fitted.slice(0, -1).trimEnd())).toBe(true);
  });

  it("a short note is left unchanged", () => {
    expect(fitNote("Short note.", "VCA Animal Hospitals")).toBe("Short note.");
  });
});

describe("vet rules", () => {
  it("each rule has text and at least one source with an https url", () => {
    const rules = [VET_RULES.treats10.dog, VET_RULES.treats10.cat, VET_RULES.largeBreed, VET_RULES.catsCarnivore, VET_RULES.fishCats];
    for (const r of rules) {
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.sources.length).toBeGreaterThan(0);
      for (const s of r.sources) expect(s.url.startsWith("https://")).toBe(true);
      expect(r.text).not.toMatch(/NOT FOUND|in this run/);
    }
  });

  it("the emergency fee notes come from the JSON", () => {
    expect(EMERGENCY.aspca.fee).toBe("A consultation fee may apply.");
    expect(EMERGENCY.pph.fee).toBe("$99 USD per incident fee applies.");
  });
});
