import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  dishComponents,
  dishImageKey,
  dishPrompt,
  generateDrinkImage,
  generatePetBowlImage,
  pairingDrinkImageKey,
  petBowlImageKey,
} from "../images/dish";
import { AiQuotaError } from "../ai/dailyQuota";
import { drinkImagePrompt } from "../pairings/imagePrompt";
import { publicImageFor } from "../images/pick";
import { makeRecipe } from "./fixtures";

vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return {
    ...actual,
    head: vi.fn(async () => {
      throw new actual.BlobNotFoundError();
    }),
    put: vi.fn(async (key: string) => ({ url: `https://blob.test/${key}` })),
  };
});

const base = () =>
  makeRecipe({
    id: "spinach-feta-egg-scramble",
    title: "Spinach Feta Egg Scramble",
    slot: "breakfast",
    ingredients: [
      { key: "eggs", grams: 150, display: "3 large eggs" },
      { key: "spinach", grams: 60, display: "1 cup baby spinach" },
      { key: "feta", grams: 40, display: "2 tbsp crumbled feta" },
      { key: "olive_oil", grams: 5, display: "1 tsp olive oil" },
      { key: "salt", grams: 1, display: "pinch of salt" },
      { key: "black_pepper", grams: 1, display: "pepper (to taste), ground" },
      { key: "tomatoes", grams: 90, display: "1/2 medium tomato, diced" },
      { key: "whole_wheat_bread", grams: 60, display: "1 slice whole wheat bread" },
    ],
  });

describe("dishImageKey", () => {
  it("is stable for the same recipe", () => {
    expect(dishImageKey(base())).toBe(dishImageKey(base()));
  });

  it("starts with dishes/<id>- and ends in .jpg", () => {
    expect(dishImageKey(base())).toMatch(/^dishes\/spinach-feta-egg-scramble-[0-9a-f]{10}\.jpg$/);
  });

  it("changes when the ingredients change", () => {
    const changed = makeRecipe({
      ...base(),
      ingredients: [...base().ingredients, { key: "garlic", grams: 3, display: "1 clove garlic" }],
    });
    expect(dishImageKey(changed)).not.toBe(dishImageKey(base()));
  });

  it("does not change when only the order of ingredients changes", () => {
    const reversed = makeRecipe({ ...base(), ingredients: [...base().ingredients].reverse() });
    expect(dishImageKey(reversed)).toBe(dishImageKey(base()));
  });
});

describe("dishPrompt", () => {
  it("contains the title", () => {
    expect(dishPrompt(base())).toContain("Spinach Feta Egg Scramble");
  });

  it("lists at most 5 components, heaviest first, without quantities", () => {
    const parts = dishComponents(base());
    expect(parts.length).toBeLessThanOrEqual(5);
    expect(parts[0]).toBe("eggs");
    expect(parts).not.toContain("3 large eggs");
    expect(dishPrompt(base())).not.toMatch(/\b3 large eggs\b/);
  });

  it("never says AI or render", () => {
    const prompt = dishPrompt(base());
    expect(prompt).not.toMatch(/\bAI\b/);
    expect(prompt.toLowerCase()).not.toContain("render");
  });

  it("is deterministic per recipe id", () => {
    expect(dishPrompt(base())).toBe(dishPrompt(base()));
  });

  it("never puts an ordinary dish in a skillet", () => {
    for (let i = 0; i < 200; i++) {
      const r = makeRecipe({ ...base(), id: `dish-${i}`, title: "Chicken Rice Bowl" });
      expect(dishPrompt(r)).not.toContain("skillet");
      expect(dishPrompt(r)).toMatch(/bowl|plate/);
    }
  });

  it("uses a skillet for about 30 % of skillet-type titles and bowls or plates for the rest", () => {
    let skillet = 0;
    const total = 200;
    for (let i = 0; i < total; i++) {
      const r = makeRecipe({ ...base(), id: `egg-${i}`, title: "Spinach Feta Egg Scramble" });
      if (dishPrompt(r).includes("skillet")) skillet++;
    }
    const share = skillet / total;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
  });
});

describe("publicImageFor", () => {
  it("prefers the generated dish photo", () => {
    const r = makeRecipe({
      imageUrl: "https://x.public.blob.vercel-storage.com/dishes/a.jpg",
      source: { url: "https://example.com/r", platform: "web", image: "https://example.com/p.jpg" },
    });
    expect(publicImageFor(r)).toBe("https://x.public.blob.vercel-storage.com/dishes/a.jpg");
  });

  it("falls back to the source photo", () => {
    const r = makeRecipe({
      source: { url: "https://example.com/r", platform: "web", image: "https://example.com/p.jpg" },
    });
    expect(publicImageFor(r)).toBe("https://example.com/p.jpg");
  });

  it("falls back to the category photo", () => {
    expect(publicImageFor(makeRecipe({ imageKey: "taco-bowl" }))).toBe("/media/taco-bowl.jpg");
  });
});

describe("petBowlImageKey", () => {
  const prompt = "Overhead photograph of chicken and rice in a white bowl.";

  it("is stable for the same prompt and changes when only the last word changes", () => {
    expect(petBowlImageKey("dog_chicken_rice", prompt)).toBe(petBowlImageKey("dog_chicken_rice", prompt));
    expect(petBowlImageKey("dog_chicken_rice", prompt)).not.toBe(petBowlImageKey("dog_chicken_rice", prompt.replace(/\.$/, "!")));
  });
});

describe("generatePetBowlImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("two concurrent misses for the same bowl share one Gemini call", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const gemini = vi.fn(
      async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", gemini);
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const prompt = "Overhead photograph of chicken and rice in a white bowl.";
    const [a, b] = await Promise.all([
      generatePetBowlImage("dog_chicken_rice", prompt),
      generatePetBowlImage("dog_chicken_rice", prompt),
    ]);

    expect(gemini).toHaveBeenCalledTimes(1);
    expect(a.url).toBe(b.url);
    expect(a.url).toBe(`https://blob.test/${petBowlImageKey("dog_chicken_rice", prompt)}`);
  });

  it("one person out of slots does not refuse the other waiting for the same photo", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const gemini = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", gemini);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const prompt = "Overhead photograph of turkey and oats in a white bowl.";
    const out = vi.fn(async () => false);
    const has = vi.fn(async () => true);
    const [a, b] = await Promise.allSettled([generatePetBowlImage("dog_turkey", prompt, out), generatePetBowlImage("dog_turkey", prompt, has)]);
    expect(a).toMatchObject({ status: "rejected", reason: expect.any(AiQuotaError) });
    expect(b).toMatchObject({ status: "fulfilled" });
    expect(has).toHaveBeenCalledTimes(1);
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it("nor the admin, who has no limit", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ffffff" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }), { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const prompt = "Overhead photograph of beef and peas in a white bowl.";
    const [a, b] = await Promise.allSettled([generatePetBowlImage("dog_beef", prompt, async () => false), generatePetBowlImage("dog_beef", prompt)]);
    expect([a.status, b.status]).toEqual(["rejected", "fulfilled"]);
  });
});

describe("generateDrinkImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("two concurrent misses for the same drink share one Gemini call and one blob path", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const gemini = vi.fn(
      async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", gemini);
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const [a, b] = await Promise.all([generateDrinkImage("dry-riesling"), generateDrinkImage("dry-riesling")]);

    expect(gemini).toHaveBeenCalledTimes(1);
    expect(a.url).toBe(b.url);
    expect(a.url).toMatch(/^https:\/\/blob\.test\/pairing-drinks\/dry-riesling-[0-9a-f]{10}\.jpg$/);
  });

  it("rejects an unknown styleId without calling Gemini", async () => {
    const gemini = vi.fn();
    vi.stubGlobal("fetch", gemini);
    await expect(generateDrinkImage("not-a-drink")).rejects.toThrow(/unknown drink styleId/);
    expect(gemini).not.toHaveBeenCalled();
  });
});

describe("pairingDrinkImageKey", () => {
  it("changes when the prompt changes and stays the same for the same prompt", () => {
    const prompt = drinkImagePrompt("dry-riesling");
    expect(pairingDrinkImageKey("dry-riesling", prompt)).toBe(pairingDrinkImageKey("dry-riesling", prompt));
    expect(pairingDrinkImageKey("dry-riesling", prompt)).not.toBe(pairingDrinkImageKey("dry-riesling", `${prompt} `));
  });
});
