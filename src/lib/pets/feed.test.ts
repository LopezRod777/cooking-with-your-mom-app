import { describe, expect, it } from "vitest";
import { Pet } from "../schemas";
import type { BowlEntry } from "./bowls";
import { dateKey } from "./energy";
import { alreadyFed, appendFeed, cookFeedId, hex8 } from "./feed";

const now = new Date(2026, 9, 15, 12, 0, 0);
const today = dateKey(now);

// Neutered adult dog, 10 kg: MER about 630 kcal, 10 % extras about 62 kcal.
const pet: Pet = Pet.parse({
  id: "petdog0001",
  name: "Rex",
  species: "dog",
  weightKg: 10,
  bornYearMonth: "2020-01",
  neutered: true,
  restrictions: [],
  extrasLog: [],
});

function entry(id: string, date = today): BowlEntry {
  return {
    id,
    date,
    kcal: 17,
    label: "Test recipe · Rex's portion",
    components: [{ foodId: "chicken_breast_cooked", grams: 10, kcal: 16.5 }],
  };
}

describe("cookFeedId", () => {
  it("is 18 characters and fits the 24-character extrasLog id limit", () => {
    const id = cookFeedId("chicken-rice", "petdog0001", today);
    expect(id).toHaveLength(18);
    expect(id).toMatch(/^ck[0-9a-f]{16}$/);
  });

  it("is deterministic", () => {
    expect(cookFeedId("chicken-rice", "petdog0001", today)).toBe(cookFeedId("chicken-rice", "petdog0001", today));
  });

  it("differs across recipe, pet and date", () => {
    const base = cookFeedId("chicken-rice", "petdog0001", today);
    expect(cookFeedId("salmon-bowl", "petdog0001", today)).not.toBe(base);
    expect(cookFeedId("chicken-rice", "petdog0002", today)).not.toBe(base);
    expect(cookFeedId("chicken-rice", "petdog0001", "2026-10-16")).not.toBe(base);
  });

  it("hex8 is FNV-1a 32-bit (empty string is the offset basis)", () => {
    expect(hex8("")).toBe("811c9dc5");
    expect(hex8("a")).toBe("e40c292c");
  });
});

describe("alreadyFed", () => {
  it("is true only for an id in the log", () => {
    const id = cookFeedId("chicken-rice", "petdog0001", today);
    expect(alreadyFed(pet, id)).toBe(false);
    const fed = appendFeed(pet, entry(id), now);
    expect(alreadyFed(fed, id)).toBe(true);
    expect(alreadyFed(fed, cookFeedId("salmon-bowl", "petdog0001", today))).toBe(false);
  });
});

describe("feed log entries", () => {
  it("a Pet carrying a cook-feed entry passes the wire schema", () => {
    const id = cookFeedId("chicken-rice", "petdog0001", today);
    const fed = appendFeed(pet, entry(id), now);
    expect(fed.extrasLog).toHaveLength(1);
    expect(() => Pet.parse(fed)).not.toThrow();
  });

  it("appendFeed twice with the same entry keeps one log item", () => {
    const id = cookFeedId("chicken-rice", "petdog0001", today);
    const once = appendFeed(pet, entry(id), now);
    const twice = appendFeed(once, entry(id), now);
    expect(twice.extrasLog).toHaveLength(1);
  });

  it("appendFeed with a different id keeps two items", () => {
    const a = appendFeed(pet, entry(cookFeedId("chicken-rice", "petdog0001", today)), now);
    const b = appendFeed(a, entry(cookFeedId("salmon-bowl", "petdog0001", today)), now);
    expect(b.extrasLog).toHaveLength(2);
  });

  it("appendFeed refuses an entry that no longer fits (wrong date)", () => {
    const stale = appendFeed(pet, entry(cookFeedId("chicken-rice", "petdog0001", "2026-10-14"), "2026-10-14"), now);
    expect(stale.extrasLog).toHaveLength(0);
  });
});
