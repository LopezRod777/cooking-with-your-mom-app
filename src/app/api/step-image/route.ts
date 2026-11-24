import { readJsonCapped } from "../../../lib/http/readJsonCapped";
import { requireUser } from "../../../lib/auth/requireUser";
import { getSql } from "../../../lib/db";
import { z } from "zod";
import { findStepImage, generateStepImage } from "../../../lib/images/steps";
import { reserveSharedQuota } from "../../../lib/ai/dailyQuota";
import { takeStepImageSlots } from "../../../lib/images/stepBudget";
import { Recipe } from "../../../lib/schemas";

export const maxDuration = 120;

const Body = z.object({ recipeId: z.string().min(1).max(120), step: z.int().min(0).max(13) });

// At most 3 Gemini generations per instance; the rest wait their turn. A finished slot passes to the next waiter.
const MAX_CONCURRENT = 3;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENT) {
    running++;
  } else {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { recipeId, step } = parsed.data;

  // The recipe and the skill come from the server copy of the person's state, never from the client.
  const rows = (await getSql().query("select state from app_state where user_id = $1", [u.userId])) as Array<{ state: { profile?: { skill?: string }; plan?: { recipes?: Record<string, unknown> }; favoriteRecipes?: Record<string, unknown> } | null }>;
  const state = rows[0]?.state;
  if (state?.profile?.skill !== "beginner") return Response.json({ error: "Step photos are for the person still learning." }, { status: 403 });
  const raw = state.plan?.recipes?.[recipeId] ?? state.favoriteRecipes?.[recipeId];
  const recipe = Recipe.safeParse(raw);
  if (!recipe.success) return Response.json({ error: "Mama can't find that recipe." }, { status: 404 });
  if (step >= recipe.data.steps.length) return Response.json({ error: "Invalid request" }, { status: 400 });

  // Cached: free, no reservation.
  const cached = await findStepImage(recipe.data, step);
  if (cached) return Response.json({ url: cached, cached: true });

  // Photos are made in order: step i uses step i−1 as a reference, so i−1 must already exist (the page asks in
  // order; this keeps one request from fanning out into a chain of generations).
  if (step > 1 && !(await findStepImage(recipe.data, step - 1))) {
    return Response.json({ error: "Steps are photographed in order." }, { status: 409 });
  }
  // Step 0 is the reference for the rest: if it is missing too, this request spends two slots.
  const needsFirst = step > 0 && !(await findStepImage(recipe.data, 0));
  const slots = needsFirst ? 2 : 1;
  if (!(await takeStepImageSlots(u.userId, slots)) || !(await reserveSharedQuota("step-image", slots))) {
    return Response.json({ error: "Mama's camera needs a rest today. Try tomorrow." }, { status: 429 });
  }
  try {
    const { url, cached: wasCached } = await withSlot(() => generateStepImage(recipe.data, step));
    return Response.json({ url, cached: wasCached });
  } catch (err) {
    console.error("[step-image] failed", recipeId, step, err instanceof Error ? err.message : err);
    return Response.json({ error: "Step photo is not available right now." }, { status: 502 });
  }
}
