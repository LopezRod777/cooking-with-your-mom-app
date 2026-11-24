import { describe, expect, it } from "vitest";
import { navItems } from "../../components/nav";

const labels = (o: { hasPets: boolean | null; cookForPets?: boolean | null; pairings: boolean }) => navItems(o).map((i) => i.label);

describe("navItems", () => {
  it("keeps the six tabs when pets were not asked and pairings are locked", () => {
    expect(labels({ hasPets: null, pairings: false })).toEqual(["Week", "Shop", "Favorites", "Community", "Pets", "Settings"]);
  });
  it("hides Pets only on an explicit no", () => {
    expect(labels({ hasPets: false, pairings: false })).toEqual(["Week", "Shop", "Favorites", "Community", "Settings"]);
    expect(labels({ hasPets: true, pairings: false })).toContain("Pets");
  });
  it("hides Pets when they have pets but don't cook for them", () => {
    expect(labels({ hasPets: true, cookForPets: false, pairings: false })).toEqual(["Week", "Shop", "Favorites", "Community", "Settings"]);
    expect(labels({ hasPets: true, cookForPets: true, pairings: false })).toContain("Pets");
    expect(labels({ hasPets: true, cookForPets: null, pairings: false })).toContain("Pets");
  });
  it("adds Pairings before Settings while the 21+ gate is open", () => {
    expect(labels({ hasPets: true, pairings: true })).toEqual(["Week", "Shop", "Favorites", "Community", "Pets", "Pairings", "Settings"]);
    expect(labels({ hasPets: false, pairings: true })).toEqual(["Week", "Shop", "Favorites", "Community", "Pairings", "Settings"]);
  });
});
