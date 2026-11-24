import { describe, expect, it } from "vitest";
import { AppState, AppStateWire, DEFAULT_STATE, Person, Pet, Places, PreferredStore, Profile, Recipe, Restriction, GOALS, WeekPlan } from "../schemas";
import { rawRecipe } from "./fixtures";

describe("Person schema", () => {
  it("strips the retired cycle key from saved rows", () => {
    const out = Person.parse({ id: "x", cycle: { starts: ["2026-01-01"], showOnWeek: true } });
    expect(out).not.toHaveProperty("cycle");
  });
});

describe("Recipe schema", () => {
  it("accepts a valid recipe", () => {
    expect(Recipe.safeParse(rawRecipe()).success).toBe(true);
  });

  it("rejects an ingredient key that is not in the catalog", () => {
    const bad = rawRecipe({
      ingredients: [
        { key: "not_a_real_food", grams: 100, display: "100 g mystery" },
        { key: "eggs", grams: 50, display: "1 egg" },
      ],
    });
    expect(Recipe.safeParse(bad).success).toBe(false);
  });
});

describe("Profile diet", () => {
  it("defaults diet to none when a saved profile has no diet field", () => {
    const parsed = Profile.parse({ version: 1, onboarded: true });
    expect(parsed.diet).toBe("none");
  });

  it("rejects a diet string outside the allowed set", () => {
    expect(Profile.safeParse({ version: 1, diet: "fruitarian" }).success).toBe(false);
  });
});

describe("Profile goal", () => {
  it("defaults goal to eat_well when the field is missing", () => {
    expect(Profile.parse({ version: 1, onboarded: true }).goal).toBe("eat_well");
  });

  it("accepts every goal in GOALS, including rapid_fat_loss and clean_bulk", () => {
    for (const g of GOALS) expect(Profile.parse({ version: 1, goal: g.id }).goal).toBe(g.id);
    expect(GOALS.map((g) => g.id)).toEqual(["grow", "eat_well", "lean", "rapid_fat_loss", "clean_bulk"]);
  });

  it("falls back to eat_well for a goal outside the allowed set (retired 'maintain' included)", () => {
    expect(Profile.parse({ version: 1, goal: "bulk" }).goal).toBe("eat_well");
    expect(Profile.parse({ version: 1, goal: "maintain" }).goal).toBe("eat_well");
  });
});

const dogPet = {
  id: "pet_aaaa01",
  name: "Nala",
  species: "dog" as const,
  weightKg: 10,
  bornYearMonth: "2024-05",
  neutered: true,
};

describe("schema 2: places and restrictions", () => {
  const place = { id: "loc_abc12345", label: "02143", radiusMiles: 3 as const };

  it("AppStateWire requires schema 9 and places", () => {
    expect(AppStateWire.safeParse(DEFAULT_STATE).success).toBe(true);
    const noSchema: Record<string, unknown> = { ...DEFAULT_STATE };
    delete noSchema.schema;
    expect(AppStateWire.safeParse(noSchema).success).toBe(false);
    const noPlaces: Record<string, unknown> = { ...DEFAULT_STATE };
    delete noPlaces.places;
    expect(AppStateWire.safeParse(noPlaces).success).toBe(false);
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 1 }).success).toBe(false);
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 2 }).success).toBe(false);
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 3 }).success).toBe(false);
  });

  it("AppState fills schema 5 and empty places when missing", () => {
    const old: Record<string, unknown> = { ...DEFAULT_STATE };
    delete old.schema;
    delete old.places;
    const parsed = AppState.parse(old);
    expect(parsed.schema).toBe(11);
    expect(parsed.places).toEqual({ saved: [] });
  });

  it("AppState reads a schema 2 state and re-serializes it as schema 11, keeping its data", () => {
    const v2 = { ...DEFAULT_STATE, schema: 2, pets: [{ ...dogPet, breed: "Beagle", photo: { key: "pets/u/p.jpg", updatedAt: "2026-10-31T10:00:00.000Z" } }] };
    const parsed = AppState.parse(v2);
    expect(parsed.schema).toBe(11);
    const roundTrip = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
    expect(roundTrip.schema).toBe(11);
    expect(AppStateWire.safeParse(roundTrip).success).toBe(true);
    expect(parsed.pets[0].breed).toBe("Beagle");
    expect(parsed.pets[0].photo?.key).toBe("pets/u/p.jpg");
  });

  it("AppState reads a schema 3 state with no drinks budget as null and re-serializes it as schema 11", () => {
    const v3Profile: Record<string, unknown> = { ...DEFAULT_STATE.profile };
    delete v3Profile.drinksBudgetUsd;
    const v3 = { ...DEFAULT_STATE, schema: 3, profile: v3Profile };
    const parsed = AppState.parse(v3);
    expect(parsed.schema).toBe(11);
    expect(parsed.profile.drinksBudgetUsd).toBeNull();
    const roundTrip = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
    expect(roundTrip.schema).toBe(11);
    expect(AppStateWire.safeParse(roundTrip).success).toBe(true);
  });

  it("AppState rejects schema values other than 2 to 11", () => {
    expect(AppState.safeParse({ ...DEFAULT_STATE, schema: 1 }).success).toBe(false);
    expect(AppState.safeParse({ ...DEFAULT_STATE, schema: 10 }).success).toBe(true);
    expect(AppState.safeParse({ ...DEFAULT_STATE, schema: 12 }).success).toBe(false);
    expect(AppState.safeParse({ ...DEFAULT_STATE, schema: 4 }).success).toBe(true);
    expect(AppState.safeParse({ ...DEFAULT_STATE, schema: 5 }).success).toBe(true);
    expect(AppState.safeParse({ ...DEFAULT_STATE, schema: 6 }).success).toBe(true);
    expect(AppState.parse({ ...DEFAULT_STATE, schema: 5 }).schema).toBe(11);
    // A stage-1 row (schema 5, people with a self-chosen plate) still reads; the plate is retired and the body fields start empty.
    const stage1 = AppState.parse({ ...DEFAULT_STATE, schema: 5, people: [{ id: "a", name: "Diego", plate: "hearty" }] });
    expect(stage1.people[0]).toMatchObject({ id: "a", name: "Diego", sex: null, weightKg: null, goal: "eat_well" });
    expect("plate" in stage1.people[0]).toBe(false);
    // A stage-1 client cannot write: its PUT body says schema 5 and is rejected as outdated.
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 5 }).success).toBe(false);
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 6 }).success).toBe(false);
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 9 }).success).toBe(false);
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 11 }).success).toBe(true);
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, schema: 8 }).success).toBe(false);
  });

  it("Profile drinksBudgetUsd: null by default, integer 0 to 300", () => {
    expect(Profile.parse({ version: 1 }).drinksBudgetUsd).toBeNull();
    expect(Profile.parse({ version: 1, drinksBudgetUsd: 25 }).drinksBudgetUsd).toBe(25);
    expect(Profile.parse({ version: 1, drinksBudgetUsd: 0 }).drinksBudgetUsd).toBe(0);
    expect(Profile.safeParse({ version: 1, drinksBudgetUsd: 301 }).success).toBe(false);
    expect(Profile.safeParse({ version: 1, drinksBudgetUsd: -1 }).success).toBe(false);
    expect(Profile.safeParse({ version: 1, drinksBudgetUsd: 12.5 }).success).toBe(false);
  });

  it("AppStateWire needs profile.drinksBudgetUsd explicitly (null is fine, missing is not)", () => {
    const withNull = { ...DEFAULT_STATE, profile: { ...DEFAULT_STATE.profile, drinksBudgetUsd: null } };
    expect(AppStateWire.safeParse(withNull).success).toBe(true);
    const profileWithout: Record<string, unknown> = { ...DEFAULT_STATE.profile };
    delete profileWithout.drinksBudgetUsd;
    expect(AppStateWire.safeParse({ ...DEFAULT_STATE, profile: profileWithout }).success).toBe(false);
  });

  it("saved places: at most 5, unique ids, radius only from the seven steps", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ ...place, id: `loc_id${i}0000` }));
    expect(Places.safeParse({ saved: six }).success).toBe(false);
    expect(Places.safeParse({ saved: [place, place] }).success).toBe(false);
    expect(Places.safeParse({ saved: [{ ...place, radiusMiles: 4 }] }).success).toBe(false);
    expect(Places.safeParse({ saved: [{ ...place, radiusMiles: 7.5 }] }).success).toBe(true);
  });

  it("restriction text is only allowed with kind other", () => {
    expect(Restriction.safeParse({ kind: "chicken" }).success).toBe(true);
    expect(Restriction.safeParse({ kind: "chicken", text: "no" }).success).toBe(false);
    expect(Restriction.safeParse({ kind: "other", text: "soy" }).success).toBe(true);
    expect(Restriction.safeParse({ kind: "unknown" }).success).toBe(false);
  });

  it("pets default to no restrictions and at most 8 are allowed", () => {
    expect(Pet.parse(dogPet).restrictions).toEqual([]);
    const nine = Array.from({ length: 9 }, () => ({ kind: "fish" as const }));
    expect(Pet.safeParse({ ...dogPet, restrictions: nine }).success).toBe(false);
  });

  it("extras log entries accept an id and up to 8 components", () => {
    const entry = { date: "2026-10-30", kcal: 50, label: "Chicken bowl", id: "e1", components: [{ foodId: "chicken", grams: 40, kcal: 30 }] };
    expect(Pet.safeParse({ ...dogPet, extrasLog: [entry] }).success).toBe(true);
    const nine = Array.from({ length: 9 }, () => ({ foodId: "rice", grams: 5, kcal: 5 }));
    expect(Pet.safeParse({ ...dogPet, extrasLog: [{ ...entry, components: nine }] }).success).toBe(false);
  });
});

describe("Pet state", () => {
  it("an old state without pets parses with []", () => {
    const old: Record<string, unknown> = { ...DEFAULT_STATE };
    delete old.pets;
    expect(AppState.parse(old).pets).toEqual([]);
  });

  it("7 pets fail", () => {
    const pets = Array.from({ length: 7 }, (_, i) => ({ ...dogPet, id: `pet_id${i}00` }));
    expect(AppState.safeParse({ ...DEFAULT_STATE, pets }).success).toBe(false);
  });

  it("duplicate ids fail", () => {
    const pets = [dogPet, { ...dogPet, name: "Otro" }];
    expect(AppState.safeParse({ ...DEFAULT_STATE, pets }).success).toBe(false);
  });

  it("AppStateWire without pets fails", () => {
    const old: Record<string, unknown> = { ...DEFAULT_STATE };
    delete old.pets;
    expect(AppStateWire.safeParse(old).success).toBe(false);
    expect(AppStateWire.safeParse(DEFAULT_STATE).success).toBe(true);
  });
});

describe("PreferredStore krogerLocationId", () => {
  const store = { id: "osm:node/1", name: "Safeway", lat: 39.98, lng: -105.25 };
  it("accepts a Kroger id, null (looked up, not Kroger) and absence (not looked up yet)", () => {
    expect(PreferredStore.safeParse({ ...store, krogerLocationId: "01400943" }).success).toBe(true);
    expect(PreferredStore.safeParse({ ...store, krogerLocationId: null }).success).toBe(true);
    expect(PreferredStore.safeParse(store).success).toBe(true);
  });
  it("rejects an id longer than 20 characters", () => {
    expect(PreferredStore.safeParse({ ...store, krogerLocationId: "x".repeat(21) }).success).toBe(false);
  });
});

describe("Pet photo and breed", () => {
  const withPhoto = { ...dogPet, breed: "Beagle", photo: { key: "pets/user_A/pet_aaaa01.jpg", updatedAt: "2026-10-31T10:00:00.000Z" } };

  it("accepts a photo and a breed", () => {
    expect(Pet.safeParse(withPhoto).success).toBe(true);
  });

  it("still accepts a pet with neither", () => {
    expect(Pet.safeParse(dogPet).success).toBe(true);
  });

  it("rejects a breed over 40 characters", () => {
    expect(Pet.safeParse({ ...dogPet, breed: "x".repeat(41) }).success).toBe(false);
    expect(Pet.safeParse({ ...dogPet, breed: "x".repeat(40) }).success).toBe(true);
  });

  it("rejects a photo without updatedAt or with a bad timestamp", () => {
    expect(Pet.safeParse({ ...dogPet, photo: { key: "k" } }).success).toBe(false);
    expect(Pet.safeParse({ ...dogPet, photo: { key: "k", updatedAt: "yesterday" } }).success).toBe(false);
  });
});

describe("Profile hasPets", () => {
  it("is null until asked, accepts true/false, and old stored profiles parse", () => {
    expect(Profile.parse({ version: 1 }).hasPets).toBeNull();
    expect(Profile.parse({ version: 1, hasPets: false }).hasPets).toBe(false);
    expect(Profile.parse({ version: 1, hasPets: true }).hasPets).toBe(true);
    expect(Profile.safeParse({ version: 1, hasPets: "yes" }).success).toBe(false);
  });
});

describe("Profile cookForPets and petIntro", () => {
  it("default to null; petIntro takes an id with every other field optional", () => {
    const p = Profile.parse({ version: 1 });
    expect(p.cookForPets).toBeNull();
    expect(p.petIntro).toBeNull();
    const withIntro = Profile.parse({ version: 1, cookForPets: true, petIntro: { id: "abc123def456" } });
    expect(withIntro.petIntro).toEqual({ id: "abc123def456" });
    const full = Profile.parse({
      version: 1,
      petIntro: { id: "abc123def456", name: "Ben", species: "dog", weightKg: 3.2, breed: "Pomeranian" },
    });
    expect(full.petIntro?.weightKg).toBe(3.2);
    expect(Profile.safeParse({ version: 1, petIntro: { id: "abc123def456", weightKg: 0.1 } }).success).toBe(false);
    expect(Profile.safeParse({ version: 1, petIntro: { name: "Ben" } }).success).toBe(false);
  });
});

describe("Profile drinkPairings", () => {
  it("is null until asked and accepts true/false", () => {
    expect(Profile.parse({ version: 1 }).drinkPairings).toBeNull();
    expect(Profile.parse({ version: 1, drinkPairings: false }).drinkPairings).toBe(false);
    expect(Profile.safeParse({ version: 1, drinkPairings: 1 }).success).toBe(false);
  });
});

describe("grace day and firstPlannedAt (schema 10)", () => {
  const dinner = { slot: "dinner" as const, recipeId: "lentil-soup", servings: 2 };
  const day = (dayIndex: number, meals: unknown[] = []) => ({ dayIndex, label: `Day ${dayIndex}`, meals });

  it("a WeekPlan of 8 days parses, grace defaults to false, and a 9th day fails", () => {
    const days = [{ ...day(0, [dinner]), grace: true }, ...Array.from({ length: 7 }, (_, i) => day(i + 1))];
    const ok = WeekPlan.safeParse({ version: 1, createdAt: "2026-11-04T18:00:00.000Z", days, recipes: {} });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    expect(ok.data.days[0].grace).toBe(true);
    expect(ok.data.days[1].grace).toBe(false);
    const nine = [...days, day(8)];
    expect(WeekPlan.safeParse({ version: 1, createdAt: "2026-11-04T18:00:00.000Z", days: nine, recipes: {} }).success).toBe(false);
  });

  it("AppState without firstPlannedAt parses to null and comes out as schema 11", () => {
    const old: Record<string, unknown> = { ...DEFAULT_STATE };
    delete old.firstPlannedAt;
    const parsed = AppState.parse(old);
    expect(parsed.firstPlannedAt).toBeNull();
    expect(parsed.schema).toBe(11);
  });
});
