import { describe, expect, it } from "vitest";
import { inferStepAction, momTimerLine, stepActionFor } from "../stepAction";

describe("inferStepAction", () => {
  it.each([
    ["Finely chop the celery and red onion.", "chop"],
    ["Whisk the eggs with salt until no streaks remain.", "whisk"],
    ["Rinse the rice under cold water.", "rinse"],
    ["Bring a pot of water to a boil.", "boil"],
    ["Bake the potatoes for 40 minutes.", "bake"],
    ["Season the chicken with salt and pepper.", "season"],
    ["Stir the sauce until it thickens.", "stir"],
    ["Sear the steak until brown on both sides.", "sear"],
    ["Plate the salad and serve right away.", "plate"],
    ["Let the dough rest for ten minutes.", "rest"],
    ["Enjoy it while it's warm.", "stir"],
  ] as const)("maps %j to %s", (text, action) => {
    expect(inferStepAction(text)).toBe(action);
  });

  it("is case-insensitive and first match wins", () => {
    expect(inferStepAction("CHOP the herbs")).toBe("chop");
    // "stir" and "pan" both appear; the stir rule comes first.
    expect(inferStepAction("Stir in the pan")).toBe("stir");
  });
});

describe("stepActionFor", () => {
  it("prefers the stored action over the inferred one", () => {
    expect(stepActionFor({ text: "Chop the onion.", action: "rest" })).toBe("rest");
  });

  it("infers when no action is stored", () => {
    expect(stepActionFor({ text: "Chop the onion." })).toBe("chop");
  });
});

describe("momTimerLine", () => {
  it("speaks by time left", () => {
    expect(momTimerLine(1, false)).toBe("Let it be. Don't poke it.");
    expect(momTimerLine(0.61, false)).toBe("Let it be. Don't poke it.");
    expect(momTimerLine(0.6, false)).toBe("Halfway. Smells good?");
    expect(momTimerLine(0.2, false)).toBe("Halfway. Smells good?");
    expect(momTimerLine(0.19, false)).toBe("Almost. Get your plate.");
    expect(momTimerLine(0, false)).toBe("Almost. Get your plate.");
  });

  it("says done when the timer ended", () => {
    expect(momTimerLine(0, true)).toBe("Done. Pull it now.");
  });
});
