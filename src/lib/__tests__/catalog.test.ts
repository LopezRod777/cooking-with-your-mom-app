import { describe, expect, it } from "vitest";
import { ALLERGEN_TAGS, AISLES, CATALOG, CATALOG_KEYS, packageGrams, type CatalogItem } from "../catalog";

function item(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    key: "x",
    displayName: "X",
    aisle: "Pantry",
    package: { size: 1, unit: "each" },
    usda: null,
    per100g: null,
    portions: [],
    allergens: [],
    ...overrides,
  };
}

describe("catalog", () => {
  it("every catalog item sits in one of the fixed AISLES", () => {
    for (const key of CATALOG_KEYS) {
      expect(AISLES).toContain(CATALOG[key].aisle);
    }
  });

  it("CATALOG_KEYS is sorted and matches CATALOG", () => {
    expect(CATALOG_KEYS).toEqual([...CATALOG_KEYS].sort());
    expect(CATALOG_KEYS).toHaveLength(Object.keys(CATALOG).length);
  });

  it("packageGrams converts lb, oz and fl oz when no explicit value is set", () => {
    expect(packageGrams(item({ package: { size: 1, unit: "lb" } }))).toBeCloseTo(453.592, 6);
    expect(packageGrams(item({ package: { size: 8, unit: "oz" } }))).toBeCloseTo(226.796, 6);
    expect(packageGrams(item({ package: { size: 64, unit: "fl oz" } }))).toBeCloseTo(64 * 29.5735, 6);
  });

  it("packageGrams for each uses the first matching portion", () => {
    const eggsLike = item({
      package: { size: 12, unit: "each" },
      portions: [
        { label: "1 cup", grams: 243 },
        { label: "1 large", grams: 50 },
      ],
    });
    expect(packageGrams(eggsLike)).toBe(600);
  });

  it("packageGrams for each returns null when no portion matches", () => {
    const avocadoLike = item({
      package: { size: 1, unit: "each" },
      portions: [{ label: "1 avocado, NS", grams: 150 }],
    });
    expect(packageGrams(avocadoLike)).toBeNull();
  });

  it("an explicit packageGrams wins over the computed value", () => {
    expect(packageGrams(item({ package: { size: 1, unit: "lb" }, packageGrams: 500 }))).toBe(500);
  });
});

describe("allergen tags", () => {
  it("every catalog key has an allergens array of known tags", () => {
    const known = new Set<string>(ALLERGEN_TAGS.map((t) => t.id));
    for (const key of CATALOG_KEYS) {
      const tags = CATALOG[key].allergens;
      expect(Array.isArray(tags), key).toBe(true);
      for (const t of tags) expect(known.has(t), `${key}: ${t}`).toBe(true);
    }
  });
});
