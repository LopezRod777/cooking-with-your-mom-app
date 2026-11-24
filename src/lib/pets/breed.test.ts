import { describe, expect, it } from "vitest";
import type { Pet } from "../schemas";
import { ageMonths } from "./energy";
import { breedHeading, breedNotes, matchBreed, normalizeBreedText } from "./breed";

const now = new Date(2026, 9, 31);

// Birth month whose ageMonths at `now` is exactly `months` (ageMonths is 0-based from the month before birth).
function bornAt(months: number): string {
  const idx = now.getFullYear() * 12 + now.getMonth() - months - 1;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function pet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "pet_rex_0001",
    name: "Rex",
    species: "dog",
    weightKg: 9.1,
    bornYearMonth: bornAt(36),
    neutered: true,
    expectedAdultSize: "medium",
    breed: "Labrador",
    restrictions: [],
    extrasLog: [],
    ...overrides,
  };
}

describe("bornAt helper", () => {
  it.each([2, 11, 12, 17, 18, 36])("gives ageMonths %i", (months) => {
    expect(ageMonths(bornAt(months), now)).toBe(months);
  });
});

describe("normalizeBreedText", () => {
  it("folds accents, lowercases and splits on non-letters", () => {
    expect(normalizeBreedText("Dálmata, Mini-Schnauzer!")).toEqual(["dalmata", "mini", "schnauzer"]);
    expect(normalizeBreedText("")).toEqual([]);
  });
});

describe("matchBreed", () => {
  it("matches exact breeds in English and Spanish", () => {
    expect(matchBreed("Labrador")).toEqual([{ breedId: "labrador", certainty: "exact" }]);
    expect(matchBreed("Lab")).toEqual([{ breedId: "labrador", certainty: "exact" }]);
    expect(matchBreed("Dálmata")).toEqual([{ breedId: "dalmatian", certainty: "exact" }]);
    expect(matchBreed("dobermann pinscher")).toEqual([{ breedId: "doberman", certainty: "exact" }]);
    expect(matchBreed("West Highland White Terrier")).toEqual([{ breedId: "westie", certainty: "exact" }]);
    expect(matchBreed("Mini Schnauzer")).toEqual([{ breedId: "mini_schnauzer", certainty: "exact" }]);
  });

  it("marks doodles and mix words as mix", () => {
    expect(matchBreed("Labradoodle")).toEqual([{ breedId: "labrador", certainty: "mix" }]);
  });

  it("marks plain schnauzer as uncertain, also with a mix word", () => {
    expect(matchBreed("Schnauzer")).toEqual([{ breedId: "mini_schnauzer", certainty: "uncertain" }]);
    expect(matchBreed("Schnauzer mix")).toEqual([{ breedId: "mini_schnauzer", certainty: "uncertain" }]);
  });

  it("returns two breeds in word order, both mix", () => {
    expect(matchBreed("Lab x Dalmatian")).toEqual([
      { breedId: "labrador", certainty: "mix" },
      { breedId: "dalmatian", certainty: "mix" },
    ]);
  });

  it("keeps only the first two of three breeds", () => {
    expect(matchBreed("lab dalmatian doberman")).toEqual([
      { breedId: "labrador", certainty: "mix" },
      { breedId: "dalmatian", certainty: "mix" },
    ]);
  });

  it("does not match inside other words or unknown breeds", () => {
    expect(matchBreed("labradorite")).toEqual([]);
    expect(matchBreed("poodle")).toEqual([]);
    expect(matchBreed("golden retriever")).toEqual([]);
    expect(matchBreed("")).toEqual([]);
    expect(matchBreed(undefined)).toEqual([]);
    expect(matchBreed(null)).toEqual([]);
  });
});

describe("breedNotes", () => {
  it("returns nothing for a cat with a breed", () => {
    expect(breedNotes(pet({ species: "cat" }), now)).toEqual([]);
  });

  it("returns nothing for a dog without a breed", () => {
    expect(breedNotes(pet({ breed: undefined }), now)).toEqual([]);
  });

  it("gives one copper note for a medium adult Lab, with no puppy-food text", () => {
    const notes = breedNotes(pet({ breed: "Labrador", expectedAdultSize: "medium" }), now);
    expect(notes).toHaveLength(1);
    expect(notes[0].conditionId).toBe("copper_prone");
    expect(notes[0].text).toContain("Cornell");
    expect(notes[0].text).not.toContain("puppy food");
  });

  it.each([11, 12, 17])("includes growth_large for a large Lab at %i months", (months) => {
    const notes = breedNotes(pet({ breed: "Labrador", expectedAdultSize: "large", bornYearMonth: bornAt(months) }), now);
    expect(notes.map((n) => n.conditionId)).toContain("growth_large");
  });

  it("drops growth_large at 18 months", () => {
    const notes = breedNotes(pet({ breed: "Labrador", expectedAdultSize: "large", bornYearMonth: bornAt(18) }), now);
    expect(notes.map((n) => n.conditionId)).not.toContain("growth_large");
  });

  it("gives one copper note for a Lab + Doberman mix, prefixed with the first breed", () => {
    const notes = breedNotes(pet({ breed: "lab doberman mix" }), now);
    const copper = notes.filter((n) => n.conditionId === "copper_prone");
    expect(copper).toHaveLength(1);
    expect(copper[0].text.startsWith("If Rex is part Labrador Retriever or Doberman Pinscher: ")).toBe(true);
    expect(copper[0].text).toContain("Labradors and Dobermans are among");
    expect(copper[0].breedIds).toEqual(["labrador", "doberman"]);
    expect(breedHeading(notes)).toBe("About Labradors and Dobermans");
  });

  it("gives the Schnauzer pancreatitis note with the Merck threshold and kcal, never a daily gram figure", () => {
    const p = pet({ breed: "Mini Schnauzer", weightKg: 9.1, bornYearMonth: bornAt(36), neutered: true });
    const notes = breedNotes(p, now);
    expect(notes).toHaveLength(1);
    const text = notes[0].text;
    expect(text).toContain("less than 20 g fat per 1,000 kcal");
    expect(text).toContain("eating about");
    expect(text).toContain(String(Math.round(70 * 9.1 ** 0.75 * 1.6)));
    expect(text).not.toMatch(/\d+ g (of )?fat a day/);
  });

  it("omits the kcal clause for a too-young Schnauzer", () => {
    const p = pet({ breed: "Mini Schnauzer", bornYearMonth: bornAt(2) });
    const notes = breedNotes(p, now);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).not.toContain("eating about");
  });

  it("prefixes a plain 'Schnauzer mix' as a Miniature Schnauzer", () => {
    const notes = breedNotes(pet({ breed: "Schnauzer mix" }), now);
    expect(notes[0].text.startsWith("If Rex is a Miniature Schnauzer: ")).toBe(true);
  });

  it("gives a Dalmatian adult the urate note sourced to VCA", () => {
    const notes = breedNotes(pet({ breed: "Dalmatian", expectedAdultSize: "medium" }), now);
    const urate = notes.find((n) => n.conditionId === "urate");
    expect(urate).toBeDefined();
    expect(urate?.sources.some((s) => s.org === "VCA Animal Hospitals")).toBe(true);
  });
});

describe("breedHeading", () => {
  it("joins two breed plurals", () => {
    const notes = breedNotes(pet({ breed: "lab dalmatian" }), now);
    expect(breedHeading(notes)).toBe("About Labradors and Dalmatians");
  });

  it("returns an empty string for no notes", () => {
    expect(breedHeading([])).toBe("");
  });
});

describe("breedNotes wording (Codex review)", () => {
  const now = new Date(2026, 9, 31);
  it("growth note counts months, not years, at 17 months", () => {
    const p = pet({ breed: "Labrador", expectedAdultSize: "large", bornYearMonth: bornAt(17) });
    expect(ageMonths(p.bornYearMonth, now)).toBe(17);
    const growth = breedNotes(p, now).find((n) => n.conditionId === "growth_large");
    expect(growth?.text).toContain("about 17 months old");
  });
  it("Schnauzer note does not restrict every Schnauzer", () => {
    const text = breedNotes(pet({ breed: "Miniature Schnauzer" }), now)[0].text;
    expect(text).not.toMatch(/fatty extras/i);
    expect(text).toContain("Most Schnauzers do fine on a normal diet");
  });
});
