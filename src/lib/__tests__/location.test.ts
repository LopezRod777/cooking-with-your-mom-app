import { describe, expect, it } from "vitest";
import { mirrorLocation, milesText, newLocationId, nextActive, parseLocation } from "../../components/location";
import type { SavedLocation } from "../schemas";

const a: SavedLocation = { id: "loc_aaaaaaaa", label: "ZIP 02143", zip: "02143", lat: 42.38, lng: -71.1 };
const b: SavedLocation = { id: "loc_bbbbbbbb", label: "Boulder, CO", city: "Boulder", state: "CO" };
const c: SavedLocation = { id: "loc_cccccccc", label: "ZIP 80302", zip: "80302", radiusMiles: 3 };

describe("parseLocation", () => {
  it("accepts a 5-digit ZIP", () => {
    expect(parseLocation(" 02143 ")).toEqual({ label: "ZIP 02143", zip: "02143" });
  });
  it("accepts City, ST and title-cases the city", () => {
    expect(parseLocation("somerville,  ma")).toEqual({ label: "Somerville, MA", city: "Somerville", state: "MA" });
  });
  it("forgives the ways people really type it", () => {
    expect(parseLocation("Cambridge MA")).toEqual({ label: "Cambridge, MA", city: "Cambridge", state: "MA" });
    expect(parseLocation("Boston, Massachusetts")).toEqual({ label: "Boston, MA", city: "Boston", state: "MA" });
    expect(parseLocation("new york, new york")).toEqual({ label: "New York, NY", city: "New York", state: "NY" });
    expect(parseLocation("02141 Cambridge")).toEqual({ label: "ZIP 02141", zip: "02141" });
    expect(parseLocation("Somerville, MA 02143")).toEqual({ label: "ZIP 02143", zip: "02143" });
    expect(parseLocation("02143-1234")).toEqual({ label: "ZIP 02143", zip: "02143" });
    expect(parseLocation("Denver, CO, USA")).toEqual({ label: "Denver, CO", city: "Denver", state: "CO" });
  });
  it("rejects anything else", () => {
    expect(parseLocation("1234")).toBeNull();
    expect(parseLocation("Somerville")).toBeNull();
    expect(parseLocation("Somerville, Mass")).toBeNull();
    expect(parseLocation("")).toBeNull();
  });
});

describe("nextActive", () => {
  it("keeps the active id when another place is removed", () => {
    expect(nextActive([a, b, c], b.id, a.id)).toBe(a.id);
  });
  it("moves to the next place when the active one is removed", () => {
    expect(nextActive([a, b, c], a.id, a.id)).toBe(b.id);
    expect(nextActive([a, b, c], b.id, b.id)).toBe(c.id);
  });
  it("moves to the previous place when the last active one is removed", () => {
    expect(nextActive([a, b, c], c.id, c.id)).toBe(b.id);
  });
  it("is undefined when the last place is removed", () => {
    expect(nextActive([a], a.id, a.id)).toBeUndefined();
  });
});

describe("mirrorLocation", () => {
  it("copies label, zip, city and state of the active place only", () => {
    expect(mirrorLocation([a, b], b.id)).toEqual({ label: "Boulder, CO", city: "Boulder", state: "CO" });
    expect(mirrorLocation([a, b], a.id)).toEqual({ label: "ZIP 02143", zip: "02143" });
  });
  it("does not carry coordinates or radius into the location field", () => {
    expect(mirrorLocation([a], a.id)).not.toHaveProperty("lat");
    expect(mirrorLocation([c], c.id)).not.toHaveProperty("radiusMiles");
  });
  it("is null without an active place", () => {
    expect(mirrorLocation([a, b], undefined)).toBeNull();
    expect(mirrorLocation([a, b], "loc_zzzzzzzz")).toBeNull();
  });
});

describe("newLocationId", () => {
  it("is loc_ plus 8 base36 characters", () => {
    expect(newLocationId()).toMatch(/^loc_[0-9a-z]{8}$/);
  });
  it("is deterministic with an injected random source", () => {
    expect(newLocationId(() => 0)).toBe("loc_00000000");
    expect(newLocationId(() => 0.999)).toBe("loc_zzzzzzzz");
  });
});

describe("milesText", () => {
  it("uses the singular for 1 mile only", () => {
    expect(milesText(1)).toBe("1 mile");
    expect(milesText(0.5)).toBe("0.5 miles");
    expect(milesText(7.5)).toBe("7.5 miles");
  });
});
