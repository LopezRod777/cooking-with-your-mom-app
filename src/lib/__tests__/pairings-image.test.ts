import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "../auth/requireUser";
import { AiQuotaError, quotaExceededResponse, reserveAiQuota } from "../ai/dailyQuota";
import { generateDrinkImage, generatePetBowlImage } from "../images/dish";
import { drinkImageKey, drinkImagePrompt } from "../pairings/imagePrompt";
import { VOCAB } from "../pairings/vocab";
import bowls from "../../../data/pet-bowls.json";
import { POST } from "../../app/api/dish-image/route";

vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn(), isAdminEmail: vi.fn(() => false) }));
// The daily AI cap is checked in the route; this file tests the image path, so the cap always lets the call through.
vi.mock("../ai/dailyQuota", () => ({ reserveAiQuota: vi.fn(async () => true), AiQuotaError: class extends Error {}, quotaExceededResponse: vi.fn() }));
vi.mock("../images/dish", () => ({
  generateDishImage: vi.fn(),
  generatePetBowlImage: vi.fn(),
  generateDrinkImage: vi.fn(async (styleId: string) => ({ url: `https://blob.test/${styleId}.jpg`, cached: true, ms: 0 })),
}));

const BOWL_ID = bowls.dog[0].id;
const ALL_IDS = [...VOCAB.wines.map((w) => w.id), ...VOCAB.others.map((o) => o.id), ...VOCAB.zeroProof.map((z) => z.id)];

const post = (body: unknown) =>
  POST(
    new Request("https://app.test/api/dish-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ userId: "user_A", email: "a@example.com" });
});

describe("drinkImagePrompt", () => {
  it("is deterministic for every drink style", () => {
    for (const id of ALL_IDS) expect(drinkImagePrompt(id)).toBe(drinkImagePrompt(id));
  });

  it("ends every prompt with the no-text, no-labels, no-logos guard", () => {
    for (const id of ALL_IDS) {
      expect(drinkImagePrompt(id)).toContain("no text, no labels, no logos");
    }
  });

  it("uses a flute for sparkling wine, a small glass for sweet wine and a wine glass otherwise", () => {
    const prosecco = drinkImagePrompt("prosecco");
    expect(prosecco).toContain("flute");
    expect(prosecco).toContain("pale gold with fine bubbles");
    const sauternes = drinkImagePrompt("sauternes");
    expect(sauternes).toContain("small glass");
    expect(sauternes).toContain("golden");
    expect(drinkImagePrompt("dry-riesling")).toContain("wine glass");
    expect(drinkImagePrompt("dry-riesling")).toContain("pale straw");
  });

  it("names the wine by its vocab name and color word, never a brand", () => {
    const p = drinkImagePrompt("rioja");
    expect(p).toContain("An unlabeled red wine bottle");
    expect(p).toContain("Rioja");
  });

  it("builds the beer, spirit, cocktail and zero-proof scenes from the vocab kind", () => {
    expect(drinkImagePrompt("pilsner")).toContain("beside an unlabeled brown bottle");
    expect(drinkImagePrompt("bourbon")).toContain("neat");
    expect(drinkImagePrompt("margarita")).toContain("on a bar top");
    expect(drinkImagePrompt("iced-black-tea")).toContain("with ice and citrus");
  });

  it("throws on an unknown styleId", () => {
    expect(() => drinkImagePrompt("not-a-drink")).toThrow(/unknown drink styleId/);
    expect(() => drinkImageKey("not-a-drink")).toThrow(/unknown drink styleId/);
  });
});

describe("drinkImageKey", () => {
  it("is the logical key pairing-drink:<styleId>", () => {
    expect(drinkImageKey("dry-riesling")).toBe("pairing-drink:dry-riesling");
  });
});

describe("generateDrinkImage (mocked)", () => {
  it("the route returns the url of the generated drink photo", async () => {
    const res = await post({ kind: "pairing-drink", styleId: "dry-riesling" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://blob.test/dry-riesling.jpg", cached: true });
  });
});

describe("POST /api/dish-image with kind pairing-drink", () => {
  it("answers 400 for a styleId that is not in the vocabulary", async () => {
    const res = await post({ kind: "pairing-drink", styleId: "not-a-drink" });
    expect(res.status).toBe(400);
    expect(generateDrinkImage).not.toHaveBeenCalled();
  });

  it("answers 400 for an empty styleId", async () => {
    expect((await post({ kind: "pairing-drink", styleId: "" })).status).toBe(400);
  });

  it("hands the daily cap to drink and bowl photos, and answers the quota response when it is spent", async () => {
    vi.mocked(quotaExceededResponse).mockImplementation(() => Response.json({ error: "quota" }, { status: 429 }));
    await post({ kind: "pairing-drink", styleId: "dry-riesling" });
    const reserve = vi.mocked(generateDrinkImage).mock.calls[0][1];
    await reserve!();
    expect(reserveAiQuota).toHaveBeenCalledWith("user_A", "dish-image");
    vi.mocked(generateDrinkImage).mockRejectedValueOnce(new AiQuotaError());
    expect((await post({ kind: "pairing-drink", styleId: "dry-riesling" })).status).toBe(429);
    vi.mocked(generatePetBowlImage).mockRejectedValueOnce(new AiQuotaError());
    expect((await post({ kind: "pet-bowl", bowlId: BOWL_ID })).status).toBe(429);
    expect(vi.mocked(generatePetBowlImage).mock.calls[0][2]).toBeTypeOf("function");
  });

  it("returns the auth Response and generates nothing when the user is not signed in", async () => {
    vi.mocked(requireUser).mockResolvedValue(new Response(null, { status: 401 }));
    const res = await post({ kind: "pairing-drink", styleId: "dry-riesling" });
    expect(res.status).toBe(401);
    expect(generateDrinkImage).not.toHaveBeenCalled();
  });
});
