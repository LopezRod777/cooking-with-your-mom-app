import { describe, expect, it } from "vitest";
import { combineVerdicts, moderateImage } from "../community/moderate";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe("moderateImage", () => {
  it("is review without calling the classifier when off", async () => {
    let called = 0;
    const v = await moderateImage(JPEG, { enabled: false, classify: async () => { called++; return { decision: "ok", category: "none", why: "" }; } });
    expect(v).toEqual({ decision: "review", category: "none", note: "classifier off" });
    expect(called).toBe(0);
  });

  it("is review when the classifier throws", async () => {
    const v = await moderateImage(JPEG, { enabled: true, classify: async () => { throw new Error("boom"); } });
    expect(v).toMatchObject({ decision: "review", category: "none", note: "classifier failed: boom" });
  });

  it("downgrades ok to review for minor", async () => {
    const v = await moderateImage(JPEG, { enabled: true, classify: async () => ({ decision: "ok", category: "minor", why: "young person" }) });
    expect(v).toMatchObject({ decision: "review", category: "minor", note: "young person" });
  });

  it("passes ok for food", async () => {
    const v = await moderateImage(JPEG, { enabled: true, classify: async () => ({ decision: "ok", category: "none", why: "pasta" }) });
    expect(v).toMatchObject({ decision: "ok", category: "none", note: "pasta" });
  });

  it("keeps block", async () => {
    const v = await moderateImage(JPEG, { enabled: true, classify: async () => ({ decision: "block", category: "violence", why: "gore" }) });
    expect(v).toMatchObject({ decision: "block", category: "violence" });
  });

  it("is review and skips the classifier when the budget is spent", async () => {
    let called = 0;
    const v = await moderateImage(JPEG, {
      enabled: true,
      spend: async () => false,
      classify: async () => { called++; return { decision: "ok", category: "none", why: "" }; },
    });
    expect(v).toEqual({ decision: "review", category: "none", note: "daily budget spent" });
    expect(called).toBe(0);
  });
});

describe("combineVerdicts", () => {
  it("block wins over everything", () => {
    expect(combineVerdicts({ decision: "block" }, { decision: "ok" })).toBe("block");
    expect(combineVerdicts({ decision: "ok" }, { decision: "block" })).toBe("block");
  });

  it("review wins over ok", () => {
    expect(combineVerdicts({ decision: "review" }, { decision: "ok" })).toBe("review");
    expect(combineVerdicts({ decision: "ok" }, { decision: "review" })).toBe("review");
  });

  it("ok only when both are ok", () => {
    expect(combineVerdicts({ decision: "ok" }, { decision: "ok" })).toBe("ok");
  });

  it("with no photo verdict, returns the text verdict", () => {
    expect(combineVerdicts({ decision: "review" }, null)).toBe("review");
    expect(combineVerdicts({ decision: "ok" }, null)).toBe("ok");
  });
});
