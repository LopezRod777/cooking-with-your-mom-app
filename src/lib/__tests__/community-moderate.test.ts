import { describe, expect, it } from "vitest";
import { blockedWord, maskContact } from "../community/words";
import { moderateText } from "../community/moderate";

describe("community words", () => {
  it("catches slurs and insults in both languages, whole words, with leet and accents", () => {
    expect(blockedWord("what a pendejo")).toBe("pendejo");
    expect(blockedWord("PENDEJOS all of them")).toBe("pendejo");
    expect(blockedWord("p3ndejo")).toBe("pendejo");
    expect(blockedWord("f*ck this")).not.toBeNull();
    expect(blockedWord("hijo de puta")).toBe("puta");
    expect(blockedWord("Cabrón")).toBe("cabrón");
    expect(blockedWord("please kys")).toBe("kys");
  });

  it("leaves ordinary food talk alone (Scunthorpe check)", () => {
    for (const ok of ["I cooked a shiitake stir fry", "Scunthorpe pies", "the dish was a hit", "class was long", "putanesca is great", "Mama's pozole slaps", "cocktail hour", "analysis of my week"]) {
      expect(blockedWord(ok), ok).toBeNull();
    }
  });

  it("masks emails, phones, links and handles", () => {
    const r = maskContact("text me 617-555-0134 or ana@gmail.com, ig @ana.cooks, see bit.ly/x and https://a.co/z");
    expect(r.masked).toBe(true);
    expect(r.text).not.toMatch(/555|gmail|@ana|bit\.ly|https/);
    expect(maskContact("150 g chicken at 7:30 pm, 2 eggs").masked).toBe(false);
  });
});

describe("moderateText", () => {
  it("blocks on a word without calling the classifier", async () => {
    let called = 0;
    const v = await moderateText("you pendejo", { enabled: true, classify: async () => { called++; return { decision: "ok", category: "none", why: "" }; } });
    expect(v.decision).toBe("block");
    expect(called).toBe(0);
  });

  it("sends everything to review when the classifier is off, failing or out of budget", async () => {
    expect((await moderateText("hi table", { enabled: false })).decision).toBe("review");
    expect((await moderateText("hi table", { enabled: true, classify: async () => { throw new Error("boom"); } })).decision).toBe("review");
    expect((await moderateText("hi table", { enabled: true, spend: async () => false, classify: async () => ({ decision: "ok", category: "none", why: "" }) })).decision).toBe("review");
  });

  it("masks contact and reviews even when the classifier says ok; passes clean text through", async () => {
    const ok = async () => ({ decision: "ok" as const, category: "none" as const, why: "fine" });
    const masked = await moderateText("dm me at ana@gmail.com", { enabled: true, classify: ok });
    expect(masked).toMatchObject({ decision: "review", category: "contact" });
    expect(masked.text).toContain("[removed]");
    const clean = await moderateText("Meal prepped 4 lunches, feeling good", { enabled: true, classify: ok });
    expect(clean).toMatchObject({ decision: "ok", text: "Meal prepped 4 lunches, feeling good" });
    const blocked = await moderateText("subtle threat", { enabled: true, classify: async () => ({ decision: "block", category: "harassment", why: "threat" }) });
    expect(blocked.decision).toBe("block");
  });
});
