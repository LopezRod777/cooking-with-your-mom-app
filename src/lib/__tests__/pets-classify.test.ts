import { describe, expect, it } from "vitest";
import catalog from "../../../data/catalog.json";
import classificationJson from "../../../data/pet-classification.json";
import sourcesJson from "../../../data/pet-hazard-sources.json";
import { classify, hazardSource, scanRecipe } from "../pets/classify";

type Entry = { dog: string; cat: string; sourceId?: string };
const expectedKeys = (classificationJson as unknown as { keys: Record<string, Entry> }).keys;
const sources = sourcesJson as unknown as Record<string, unknown>;
const catalogKeys = (catalog as { key: string }[]).map((c) => c.key);

describe("pet classification vs catalog", () => {
  it("file covers exactly the catalog keys", () => {
    expect(catalogKeys).toHaveLength(146);
    expect(Object.keys(expectedKeys).sort()).toEqual([...catalogKeys].sort());
  });

  it.each(catalogKeys)("%s is classified as in data/pet-classification.json (dog and cat)", (key) => {
    const exp = expectedKeys[key];
    expect(exp, `missing entry for ${key}`).toBeDefined();
    expect(classify(key, "dog")).toBe(exp.dog);
    expect(classify(key, "cat")).toBe(exp.cat);
  });

  it("hazard keys are exactly the explicit list", () => {
    const hazards = catalogKeys
      .filter((k) => expectedKeys[k].dog === "hazard" || expectedKeys[k].cat === "hazard")
      .sort();
    expect(hazards).toEqual(
      ["cocoa_powder", "dark_chocolate", "garlic", "garlic_powder", "grapes", "green_onion", "onion", "onion_powder", "red_onion"].sort(),
    );
  });

  it.each(["onion_powder", "garlic_powder", "green_onion", "red_onion"])(
    "%s is hazard for both species (key must exist in catalog)",
    (key) => {
      expect(catalogKeys, `catalog has no key "${key}"; actual keys differ`).toContain(key);
      expect(classify(key, "dog")).toBe("hazard");
      expect(classify(key, "cat")).toBe("hazard");
    },
  );

  it("canned_tuna is not_for_pets for both species", () => {
    expect(classify("canned_tuna", "dog")).toBe("not_for_pets");
    expect(classify("canned_tuna", "cat")).toBe("not_for_pets");
  });

  it("chicken_breast is shareable_if_plain for both species", () => {
    expect(classify("chicken_breast", "dog")).toBe("shareable_if_plain");
    expect(classify("chicken_breast", "cat")).toBe("shareable_if_plain");
  });

  it("white_rice is shareable for dog and not_for_pets for cat", () => {
    expect(classify("white_rice", "dog")).toBe("shareable_if_plain");
    expect(classify("white_rice", "cat")).toBe("not_for_pets");
  });

  it("avocado is not_for_pets for both species", () => {
    expect(classify("avocado", "dog")).toBe("not_for_pets");
    expect(classify("avocado", "cat")).toBe("not_for_pets");
  });

  it("every hazard has a sourceId that exists in pet-hazard-sources.json", () => {
    for (const key of catalogKeys) {
      const e = expectedKeys[key];
      if (e.dog !== "hazard" && e.cat !== "hazard") continue;
      expect(e.sourceId, `hazard ${key} has no sourceId`).toBeTruthy();
      expect(sources[e.sourceId as string], `sourceId ${e.sourceId} for ${key} not in sources file`).toBeDefined();
      expect(hazardSource(key)).not.toBeNull();
    }
  });

  it("scanRecipe keeps recipe order, dedupes, and splits by class", () => {
    const r = scanRecipe(
      {
        ingredients: [
          { key: "onion" },
          { key: "chicken_breast" },
          { key: "chicken_breast" },
          { key: "salt" },
          { key: "white_rice" },
          { key: "garlic" },
        ],
      },
      "dog",
    );
    expect(r).toEqual({
      hazards: ["onion", "garlic"],
      notForPets: ["salt"],
      shareable: ["chicken_breast", "white_rice"],
    });
  });
});
