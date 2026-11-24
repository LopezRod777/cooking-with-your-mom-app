import { describe, expect, it } from "vitest";
import type { Pet } from "../schemas";
import {
  allergenOfKey,
  allowedFoods,
  blockedInfo,
  blockedReason,
  excludedFoodIds,
  foodAllowed,
  shareableForPet,
} from "../pets/restrictions";

function pet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "pet_test01",
    name: "Nala",
    species: "dog",
    weightKg: 10,
    bornYearMonth: "2024-05",
    neutered: true,
    restrictions: [],
    extrasLog: [],
    ...overrides,
  };
}

describe("restrictions: medical blocks", () => {
  it("kidney blocks everything: no allowed foods, foodAllowed false", () => {
    const p = pet({ restrictions: [{ kind: "kidney" }] });
    expect(blockedReason(p)).toBe("Extras need your vet's OK with kidney disease (therapeutic diet).");
    expect(allowedFoods(p)).toEqual([]);
    expect(foodAllowed(p, "carrot_cooked")).toBe(false);
  });

  it("kidney in a cat uses the Cornell source, in a dog the Merck source", () => {
    expect(blockedInfo(pet({ restrictions: [{ kind: "kidney" }] }))?.source?.org).toBe("Merck Veterinary Manual");
    const cat = pet({ species: "cat", restrictions: [{ kind: "kidney" }] });
    expect(blockedInfo(cat)?.source?.org).toBe("Cornell Feline Health Center");
  });

  it("pancreatitis blocks with the VCA source text", () => {
    const info = blockedInfo(pet({ restrictions: [{ kind: "pancreatitis" }] }));
    expect(info?.text).toBe("Extras need your vet's OK with pancreatitis (VCA: low-fat, easy-to-digest diet).");
    expect(info?.source?.url).toBe("https://vcahospitals.com/know-your-pet/pancreatitis-in-dogs");
  });

  it("diabetes blocks with our-rule text and no source", () => {
    const info = blockedInfo(pet({ restrictions: [{ kind: "diabetes" }] }));
    expect(info?.text).toBe("Extras need your vet's OK with diabetes (our conservative rule).");
    expect(info?.source).toBeNull();
  });

  it("other with text blocks and the text is in the message", () => {
    const p = pet({ restrictions: [{ kind: "other", text: "bladder stones" }] });
    expect(blockedReason(p)).toContain("bladder stones");
    expect(blockedReason(p)).toContain("(our conservative rule)");
    expect(allowedFoods(p)).toEqual([]);
  });

  it("no medical restriction: not blocked", () => {
    expect(blockedReason(pet())).toBeNull();
    expect(allowedFoods(pet()).length).toBeGreaterThan(0);
  });
});

describe("restrictions: allergens", () => {
  it("chicken excludes chicken breast only; the rest of the dog list stays", () => {
    const p = pet({ restrictions: [{ kind: "chicken" }] });
    expect(excludedFoodIds(p)).toEqual(new Set(["chicken_breast_cooked"]));
    const ids = allowedFoods(p).map((f) => f.id);
    expect(ids).not.toContain("chicken_breast_cooked");
    expect(ids).toEqual(expect.arrayContaining(["turkey_breast_cooked", "white_rice_cooked", "carrot_cooked"]));
    expect(foodAllowed(p, "chicken_breast_cooked")).toBe(false);
    expect(foodAllowed(p, "turkey_breast_cooked")).toBe(true);
  });

  it("grain excludes rice and oats", () => {
    const p = pet({ restrictions: [{ kind: "grain" }] });
    expect(excludedFoodIds(p)).toEqual(new Set(["white_rice_cooked", "oats_cooked"]));
  });

  it("allergens do not block the whole list", () => {
    expect(blockedReason(pet({ restrictions: [{ kind: "fish" }, { kind: "egg" }] }))).toBeNull();
  });
});

describe("shareableForPet", () => {
  const recipe = {
    ingredients: [
      { key: "chicken_breast" },
      { key: "ground_turkey" },
      { key: "carrots" },
      { key: "beef_sirloin" },
      { key: "eggs" },
      { key: "brown_rice" },
    ],
  };

  it("no restrictions: every shareable key stays, in recipe order", () => {
    expect(shareableForPet(pet(), recipe)).toEqual({
      shareable: ["chicken_breast", "ground_turkey", "carrots", "beef_sirloin", "eggs", "brown_rice"],
      vet: false,
    });
  });

  it("dog with chicken restriction: chicken breast is absent, the rest stays", () => {
    const res = shareableForPet(pet({ restrictions: [{ kind: "chicken" }] }), recipe);
    expect(res.shareable).not.toContain("chicken_breast");
    expect(res.shareable).toEqual(["ground_turkey", "carrots", "beef_sirloin", "eggs", "brown_rice"]);
    expect(res.vet).toBe(false);
  });

  it("allergen kinds map by words: beef, egg, grain, dairy each drop their keys", () => {
    const res = shareableForPet(
      pet({ restrictions: [{ kind: "beef" }, { kind: "egg" }, { kind: "grain" }, { kind: "dairy" }] }),
      recipe,
    );
    expect(res.shareable).toEqual(["chicken_breast", "ground_turkey", "carrots"]);
  });

  it("dog with pancreatitis: nothing shareable, vet line flag set", () => {
    expect(shareableForPet(pet({ restrictions: [{ kind: "pancreatitis" }] }), recipe)).toEqual({ shareable: [], vet: true });
  });

  it("kidney and other also block sharing", () => {
    expect(shareableForPet(pet({ restrictions: [{ kind: "kidney" }] }), recipe).vet).toBe(true);
    expect(shareableForPet(pet({ restrictions: [{ kind: "other", text: "bladder stones" }] }), recipe).vet).toBe(true);
  });

  it("allergenOfKey matches whole words only", () => {
    expect(allergenOfKey("eggs")).toBe("egg");
    expect(allergenOfKey("eggplant")).toBeNull();
    expect(allergenOfKey("rolled_oats")).toBe("grain");
    expect(allergenOfKey("tilapia")).toBe("fish");
    expect(allergenOfKey("carrots")).toBeNull();
    expect(allergenOfKey("milk")).toBe("dairy");
  });
});
