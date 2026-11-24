import { violatesAllergies, violatesDiet } from "../grocery";
import { perServing } from "../nutrition";
import type { MealSlot, Profile, Recipe } from "../schemas";

// Recipes the student saved (imported from a link or kept from a plan) that the week may reuse.
// Pure helpers; plan.ts decides when to call the model.

export const SAVED_MAX = 12;

const PLATFORM: Record<NonNullable<Recipe["source"]>["platform"], string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  web: "the web",
  text: "pasted text",
};

export const normTitle = (s: string) => s.trim().toLowerCase();

// Keeps only what fits the profile: an enabled slot, no allergy or diet break, inside the time cap (10 min slack).
// Imported recipes come first, duplicates by title are dropped, and the list is capped so the prompt stays short.
export function savedForPlan(saved: Recipe[], profile: Profile): Recipe[] {
  const seen = new Set<string>();
  return saved
    .filter((r) => profile.slots[r.slot])
    .filter((r) => !violatesAllergies(r, profile.allergies) && !violatesDiet(r, profile.diet))
    .filter((r) => r.prepMinutes + r.cookMinutes <= profile.maxMinutesPerMeal + 10)
    .filter((r) => {
      const key = normTitle(r.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(Boolean(b.source)) - Number(Boolean(a.source)))
    .slice(0, SAVED_MAX);
}

// Prompt block for the skeleton call. Empty when nothing is reusable.
export function savedText(saved: Recipe[], daysToPlan: number): string {
  if (saved.length === 0) return "";
  const max = Math.min(saved.length, daysToPlan);
  const lines = saved
    .map((r) => {
      const protein = perServing(r)?.protein_g;
      const from = r.source ? `, saved from ${PLATFORM[r.source.platform]}` : "";
      const p = protein ? `, about ${Math.round(protein)} g protein per serving` : "";
      return `- "${r.title}" (${r.slot}, ${r.prepMinutes + r.cookMinutes} min${p}${from})`;
    })
    .join("\n");
  return `\n\nRecipes this student saved. Reuse the ones that fit: copy the title exactly, keep its slot, use up to ${max} of them on different days (never two on the same day), and skip any that clash with the rules above.\n${lines}`;
}

export function matchSaved(saved: Recipe[], title: string, slot: MealSlot): Recipe | undefined {
  return saved.find((r) => r.slot === slot && normTitle(r.title) === normTitle(title));
}
