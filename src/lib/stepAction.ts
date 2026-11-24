import type { RecipeStep, StepAction } from "./schemas";

// Keyword rules for recipes saved before RecipeStep.action existed.
// First match wins; case-insensitive.
const RULES: ReadonlyArray<readonly [RegExp, StepAction]> = [
  [/\b(chop|dice|slice|mince|cut|halve|shred)\b/i, "chop"],
  [/\b(whisk|beat|scramble)\b/i, "whisk"],
  [/\b(rinse|drain|wash)\b/i, "rinse"],
  [/\b(boil|simmer|bring .* to a boil|cook the (rice|pasta|noodles))\b/i, "boil"],
  [/\b(bake|roast|oven|broil)\b/i, "bake"],
  [/\b(season|salt|sprinkle|drizzle|toss with)\b/i, "season"],
  [/\b(stir|fold|mix|saut[eé])\b/i, "stir"],
  [/\b(sear|brown|fry|skillet|pan|griddle|heat .* oil)\b/i, "sear"],
  [/\b(serve|plate|assemble|top with|garnish)\b/i, "plate"],
  [/\b(rest|cool|let .* sit|wait|marinate|chill)\b/i, "rest"],
];

export function inferStepAction(text: string): StepAction {
  for (const [pattern, action] of RULES) {
    if (pattern.test(text)) return action;
  }
  return "stir";
}

export function stepActionFor(step: Pick<RecipeStep, "text" | "action">): StepAction {
  return step.action ?? inferStepAction(step.text);
}

// Gerund labels shown on the clip.
export const STEP_ACTION_LABEL: Record<StepAction, string> = {
  chop: "Chopping",
  stir: "Stirring",
  sear: "Searing",
  boil: "Boiling",
  whisk: "Whisking",
  season: "Seasoning",
  rinse: "Rinsing",
  bake: "Baking",
  plate: "Plating",
  rest: "Resting",
};

// Mama's line under the timer ring. `leftFraction` is time left / total (1 = just started).
export const MOM_TIMER_LINES = {
  early: "Let it be. Don't poke it.",
  halfway: "Halfway. Smells good?",
  almost: "Almost. Get your plate.",
  done: "Done. Pull it now.",
} as const;

export function momTimerLine(leftFraction: number, done: boolean): string {
  if (done) return MOM_TIMER_LINES.done;
  if (leftFraction > 0.6) return MOM_TIMER_LINES.early;
  if (leftFraction >= 0.2) return MOM_TIMER_LINES.halfway;
  return MOM_TIMER_LINES.almost;
}
