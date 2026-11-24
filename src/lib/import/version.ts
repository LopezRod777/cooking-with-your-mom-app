// Whether Mama makes her own version of an imported recipe for this table, and why. Pure.
import { missingEquipment, toolLabel } from "../ai/kitchen";
import { adultGoalsDiffer, realAdults } from "../people";
import { DIETS, isMinor, type Person, type Profile, type Recipe } from "../schemas";

type RecipeLike = Pick<Recipe, "equipment" | "steps">;

// A goal other than "just eat well" at the table: the profile's when no grown-up card says anything, else any adult's.
function goalAtTable(profile: Pick<Profile, "goal">, people: Person[]): boolean {
  const adults = realAdults(people);
  if (adults.length === 0) return profile.goal !== "eat_well";
  return adults.some((p) => p.goal !== "eat_well");
}

// The reasons, in the order they are shown. Empty = the original is kept as imported (no second call).
export function versionReasons(recipe: RecipeLike, profile: Profile, people: Person[]): string[] {
  const out: string[] = [];
  const diet = DIETS.find((d) => d.id === profile.diet);
  if (diet && diet.id !== "none") out.push(diet.label.toLowerCase());
  const tools = missingEquipment(recipe, profile.kitchen);
  if (tools.length > 0) out.push(`no ${tools.map((t) => toolLabel(t).replace(/^(a|an) /, "")).join(", no ")}`);
  if (profile.dislikes.length > 0) out.push("skips what you dislike");
  if (people.some(isMinor)) out.push("for the little ones");
  if (adultGoalsDiffer(people)) out.push("two goals at the table");
  else if (goalAtTable(profile, people)) out.push("your goal");
  return out;
}

export function needsMamaVersion(recipe: RecipeLike, profile: Profile, people: Person[]): boolean {
  return versionReasons(recipe, profile, people).length > 0;
}
