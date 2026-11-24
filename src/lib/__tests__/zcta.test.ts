import { describe, expect, it } from "vitest";
import { nearestZcta, parseCensusZcta } from "../places/zcta";

describe("nearestZcta", () => {
  it("Somerville, MA resolves to a Somerville ZIP", () => {
    expect(["02143", "02144", "02145"]).toContain(nearestZcta(42.3876, -71.0995));
  });
  it("downtown Denver resolves to an 802xx ZIP", () => {
    expect(nearestZcta(39.7525, -104.9995)?.startsWith("802")).toBe(true);
  });
  it("the middle of the Atlantic matches nothing", () => {
    expect(nearestZcta(30, -40)).toBeUndefined();
  });
});

describe("parseCensusZcta", () => {
  it("reads the ZCTA5 of the first polygon", () => {
    const json = { result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5: "02142", GEOID: "02142", NAME: "ZCTA5 02142" }] } } };
    expect(parseCensusZcta(json)).toBe("02142");
  });
  it("ignores other layers even when they carry a 5-digit GEOID", () => {
    const json = { result: { geographies: { Counties: [{ GEOID: "25017", NAME: "Middlesex County" }], "Census Tracts": [{ GEOID: "25017352102" }] } } };
    expect(parseCensusZcta(json)).toBeUndefined();
    expect(parseCensusZcta({ result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [{ GEOID: "02142" }] } } })).toBeUndefined();
  });
  it("is undefined when there is no polygon (ocean, abroad) or the shape is off", () => {
    expect(parseCensusZcta({ result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [] } } })).toBeUndefined();
    expect(parseCensusZcta({ result: {} })).toBeUndefined();
    expect(parseCensusZcta(null)).toBeUndefined();
  });
});
