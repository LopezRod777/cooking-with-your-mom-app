import { readJsonCapped } from "../../../lib/http/readJsonCapped";
import { isAdminEmail, requireUser } from "@/lib/auth/requireUser";
import { z } from "zod";
import { aiErrorResponse } from "@/lib/ai/http";
import { quotaExceededResponse, reserveAiQuota } from "@/lib/ai/dailyQuota";
import { generateSwaps } from "@/lib/ai/plan";
import { Location, Profile, Recipe, PeopleList, CheckInList } from "@/lib/schemas";

export const maxDuration = 300;

const Body = z.object({
  profile: Profile,
  location: Location.nullable(),
  recipe: Recipe,
  otherTitles: z.array(z.string().max(60)).max(60),
  pets: z
    .array(z.object({ name: z.string().trim().min(1).max(30), species: z.enum(["dog", "cat"]) }))
    .max(6)
    .default([]),
  people: PeopleList.default([]),
  checkins: CheckInList.default([]),
});

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!isAdminEmail(u.email) && !(await reserveAiQuota(u.userId, "swap"))) return quotaExceededResponse();
  const { profile, location, recipe, otherTitles, pets, people, checkins } = parsed.data;
  try {
    const recipes = await generateSwaps(profile, location, recipe, otherTitles, pets, people, checkins);
    if (recipes.length === 0) return Response.json({ recipes: [], reason: "no_equipment_fit" });
    return Response.json({ recipes });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
