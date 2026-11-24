import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SIPS, sipRulesFor, sipsFor } from "../pets/sips";

const json = JSON.parse(readFileSync(resolve(__dirname, "../../../data/pet-sips.json"), "utf8")) as {
  sources: Record<string, { url: string; quote: string; accessedAt: string }>;
  sips: { id: string; sourceIds: string[]; how: string; note?: string }[];
};

// Words that must never appear in what a pet is offered (toxic per ASPCA / Pet Poison Helpline).
const BANNED = /\b(grape|raisin|xylitol|coffee|alcohol|chocolate|wine|beer)\b/i;

describe("pet sips", () => {
  it("every sip has at least one https source with a quote and an access date", () => {
    expect(SIPS.length).toBe(json.sips.length);
    for (const raw of json.sips) {
      expect(raw.sourceIds.length, raw.id).toBeGreaterThan(0);
      for (const id of raw.sourceIds) {
        const src = json.sources[id];
        expect(src, `${raw.id}: ${id}`).toBeDefined();
        expect(src.url.startsWith("https://")).toBe(true);
        expect(src.quote.length).toBeGreaterThan(10);
        expect(src.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      const sip = SIPS.find((s) => s.id === raw.id)!;
      expect(sip.sources.length).toBe(new Set(raw.sourceIds.map((i) => json.sources[i].url)).size);
    }
  });

  it("the 'how' line never offers a banned ingredient (notes may warn about them)", () => {
    for (const sip of SIPS) {
      expect(BANNED.test(sip.how), `${sip.id}: ${sip.how}`).toBe(false);
      expect(/\b(onion|garlic)\b/i.test(sip.how) ? /no onion or garlic/i.test(sip.how) : true, sip.id).toBe(true);
    }
  });

  it("dogs get five sips, cats get two, and the rules follow the species", () => {
    expect(sipsFor("dog").map((s) => s.id)).toEqual(["cranberry_splash", "watermelon_ice", "blueberry_cubes", "broth_cooler", "pumpkin_smoothie"]);
    expect(sipsFor("cat").map((s) => s.id)).toEqual(["cat_broth_sip", "cat_fountain"]);
    expect(sipRulesFor("dog").map((r) => r.text.slice(0, 6))).toEqual(["A sip ", "Never:"]);
    expect(sipRulesFor("cat")).toHaveLength(3);
    for (const r of [...sipRulesFor("dog"), ...sipRulesFor("cat")]) expect(r.sources.length).toBeGreaterThan(0);
  });
});
