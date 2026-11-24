import { readJsonCapped } from "../../../lib/http/readJsonCapped";
import { isAdminEmail, requireUser } from "@/lib/auth/requireUser";
import { z } from "zod";
import { aiErrorResponse } from "@/lib/ai/http";
import { quotaExceededResponse, reserveAiQuota } from "@/lib/ai/dailyQuota";
import { generateWeekPlan } from "@/lib/ai/plan";
import { warmDishImages } from "@/lib/images/warm";
import { Location, Profile, Recipe, PeopleList, CheckInList } from "@/lib/schemas";

export const maxDuration = 300;

const Body = z.object({
  profile: Profile,
  location: Location.nullable(),
  pets: z
    .array(z.object({ name: z.string().trim().min(1).max(30), species: z.enum(["dog", "cat"]) }))
    .max(6)
    .default([]),
  // Recipes the student saved (imports included). The plan reuses the ones that fit the profile.
  saved: z.array(Recipe).max(60).default([]),
  // Who eats: only counts, age bands, plate facts and relation reach the prompt. Names and dates are stripped
  // client-side (peopleForRequest in src/lib/people.ts) and ignored here. See src/lib/people.ts.
  people: PeopleList.default([]),
  // Only each person's latest "want more of" chips reach the prompt (src/lib/checkins.ts wantsPromptLine).
  checkins: CheckInList.default([]),
  // First plan of the account: tonight's dinner alone, then the days asked for (see docs/plans/2026-11-04-dia-de-gracia.md).
  graceDay: z.boolean().default(false),
});

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!isAdminEmail(u.email) && !(await reserveAiQuota(u.userId, "plan"))) return quotaExceededResponse();
  try {
    const { plan, checks } = await generateWeekPlan(parsed.data.profile, parsed.data.location, parsed.data.pets, parsed.data.saved, parsed.data.people, parsed.data.checkins, { graceDay: parsed.data.graceDay });
    // Photos start now, while the planning screen is still up, so the week lands with its pictures.
    const withPhotos = await warmDishImages(plan, isAdminEmail(u.email) ? {} : { reserve: () => reserveAiQuota(u.userId, "dish-image") });
    return Response.json({ plan: withPhotos, checks });
  } catch (err) {
    if (err instanceof Error && err.message === "plan_timeout") {
      return Response.json({ error: "That took too long. Try 3 or 5 days." }, { status: 504 });
    }
    return aiErrorResponse(err);
  }
}
