import { readJsonCapped } from "../../../../lib/http/readJsonCapped";
import { isAdminEmail, requireUser } from "@/lib/auth/requireUser";
import { z } from "zod";
import { aiErrorResponse } from "@/lib/ai/http";
import { quotaExceededResponse, reserveAiQuota } from "@/lib/ai/dailyQuota";
import { missingEquipment, needsLine } from "@/lib/ai/kitchen";
import { rewriteForProfile } from "@/lib/import/structure";
import { PeopleList, Profile, Recipe } from "@/lib/schemas";

export const maxDuration = 300;

const Body = z.object({
  recipe: Recipe,
  profile: Profile,
  // Soft preference: one plain-shareable ingredient when a pet can share (see profileText).
  pets: z
    .array(z.object({ name: z.string().trim().min(1).max(30), species: z.enum(["dog", "cat"]) }))
    .max(6)
    .default([]),
  // Same minimized rows the plan gets (peopleForRequest on the client: no name, no dates); only derived lines reach the model.
  people: PeopleList.default([]),
  // How many the version is cooked for (the people picked on the import screen); defaults to the recipe's own count.
  servings: z.int().min(1).max(8).optional(),
});

// A new recipe for this profile, built from an imported one. The original is not changed; the client saves the new one.
export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!isAdminEmail(u.email) && !(await reserveAiQuota(u.userId, "import-my-version"))) return quotaExceededResponse();
  const { recipe, profile, pets, people } = parsed.data;
  const servings = parsed.data.servings ?? recipe.servings;
  try {
    let mine = await rewriteForProfile(recipe, profile, [], pets, people, servings);
    // Needs a tool the kitchen lacks: one retry that names it; still failing → kept and marked, not rejected.
    let tools = missingEquipment(mine, profile.kitchen);
    if (tools.length > 0) {
      const retry = await rewriteForProfile(
        recipe,
        profile,
        [`${needsLine(tools)} and the student marked none. Rewrite it for what they have.`],
        pets,
        people,
        servings,
      );
      const retryTools = missingEquipment(retry, profile.kitchen);
      if (retryTools.length === 0 || retryTools.length < tools.length) {
        mine = retry;
        tools = retryTools;
      }
    }
    return Response.json({ recipe: tools.length > 0 ? { ...mine, needsEquipment: tools } : mine });
  } catch (err) {
    // The rewrite broke an allergy or the diet: say so, instead of the generic provider-failure message.
    if (err instanceof Error && (err.message === "allergy_violation" || err.message === "diet_violation")) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    return aiErrorResponse(err);
  }
}
