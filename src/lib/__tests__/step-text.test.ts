import { describe, expect, it } from "vitest";
import { flowStep } from "../stepText";

describe("flowStep", () => {
  it.each([
    [
      "Boil rice in 2 cups salted water over high heat, uncovered 20 minutes until tender. Drain.",
      "Boil rice in 2 cups salted water over high heat, uncovered 20 minutes until tender, then drain.",
    ],
    ["Heat oil. Add onion and cook 5 minutes until soft.", "Heat oil, then add onion and cook 5 minutes until soft."],
    [
      "Return beef, pour in sauce and stir 1 minute until glossy and thick. Serve over rice.",
      "Return beef, pour in sauce and stir 1 minute until glossy and thick, then serve over rice.",
    ],
    ["Toss everything together. Taste. Serve.", "Toss everything together, then taste and serve."],
    ["Sear 2 minutes per side. Rest 5 minutes.", "Sear 2 minutes per side, then rest 5 minutes."],
    ["Whisk soy sauce, honey, garlic and ginger.", "Whisk soy sauce, honey, garlic and ginger."],
    [
      "Preheat oven to 400°F. Toss broccoli with oil and salt on a sheet pan.",
      "Preheat oven to 400°F. Toss broccoli with oil and salt on a sheet pan.",
    ],
    ["Is it done? Check the center.", "Is it done? Check the center."],
    ["Season with salt. Add USDA Prime beef now.", "Season with salt, then add USDA Prime beef now."],
  ])("flows %j", (input, expected) => {
    expect(flowStep(input)).toBe(expected);
  });
});
