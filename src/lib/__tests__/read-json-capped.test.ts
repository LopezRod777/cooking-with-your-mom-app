import { describe, expect, it } from "vitest";
import { readJsonCapped } from "../http/readJsonCapped";
import { Profile } from "../schemas";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://x.test/api", { method: "POST", body, headers });

describe("readJsonCapped", () => {
  it("parses a body under the cap", async () => {
    expect(await readJsonCapped(post('{"a":1}'), 100)).toEqual({ a: 1 });
  });

  it("refuses a declared content-length over the cap without reading", async () => {
    expect(await readJsonCapped(post('{"a":1}', { "content-length": "999999" }), 100)).toBeNull();
  });

  it("refuses a streamed body that grows past the cap", async () => {
    expect(await readJsonCapped(post(JSON.stringify({ a: "x".repeat(500) })), 100)).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    expect(await readJsonCapped(post("{nope"), 100)).toBeNull();
  });
});

describe("Profile list caps", () => {
  it("trims cuisines, allergies and dislikes to 40 items of 80 chars, never rejecting", () => {
    const long = Array.from({ length: 100 }, (_, i) => `item-${i}-${"z".repeat(200)}`);
    const p = Profile.parse({ version: 1, onboarded: true, cuisines: long, allergies: long, dislikes: long });
    for (const list of [p.cuisines, p.allergies, p.dislikes]) {
      expect(list).toHaveLength(40);
      expect(list.every((s) => s.length <= 80)).toBe(true);
    }
  });
});
