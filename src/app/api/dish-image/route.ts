import { readJsonCapped } from "../../../lib/http/readJsonCapped";
import { isAdminEmail, requireUser } from "../../../lib/auth/requireUser";
import { z } from "zod";
import { AiQuotaError, quotaExceededResponse, reserveAiQuota } from "../../../lib/ai/dailyQuota";
import { generateDishImage, generateDrinkImage, generatePetBowlImage } from "../../../lib/images/dish";
import { drinkStyleIds } from "../../../lib/pairings/vocab";
import { bowlById } from "../../../lib/pets/bowls";
import { Recipe } from "../../../lib/schemas";

export const maxDuration = 120;

// Either a recipe (the dish photo), { kind: "pet-bowl", bowlId } (the shared photo of one pet bowl),
// or { kind: "pairing-drink", styleId } (the shared photo of one drink style).
const RecipeBody = z.object({ recipe: Recipe });
const PetBowlBody = z.object({ kind: z.literal("pet-bowl"), bowlId: z.string().min(1).max(60) });
const PairingDrinkBody = z.object({ kind: z.literal("pairing-drink"), styleId: z.string().min(1).max(60) });
const Body = z.union([RecipeBody, PetBowlBody, PairingDrinkBody]);

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
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const body = parsed.data;
  // Only a cache miss spends the daily slot. Drink and bowl photos too: the catalog is fixed, but a photo that fails to
  // save would be made again on every ask.
  const reserve = isAdminEmail(u.email) ? undefined : () => reserveAiQuota(u.userId, "dish-image");
  if ("recipe" in body) {
    try {
      const { url, cached } = await withSlot(() => generateDishImage(body.recipe, undefined, reserve));
      return Response.json({ url, cached });
    } catch (err) {
      if (err instanceof AiQuotaError) return quotaExceededResponse();
      console.error("[dish-image] failed", body.recipe.id, err instanceof Error ? err.message : err);
      return Response.json({ error: "Dish photo is not available right now." }, { status: 502 });
    }
  }
  if ("styleId" in body) {
    if (!drinkStyleIds.has(body.styleId)) return Response.json({ error: "Invalid request" }, { status: 400 });
    try {
      const { url, cached } = await withSlot(() => generateDrinkImage(body.styleId, reserve));
      return Response.json({ url, cached });
    } catch (err) {
      if (err instanceof AiQuotaError) return quotaExceededResponse();
      console.error("[dish-image] failed pairing-drink:", body.styleId, err instanceof Error ? err.message : err);
      return Response.json({ error: "Drink photo is not available right now." }, { status: 502 });
    }
  }
  const bowl = bowlById(body.bowlId);
  if (!bowl) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    const { url, cached } = await withSlot(() => generatePetBowlImage(bowl.id, bowl.imagePrompt, reserve));
    return Response.json({ url, cached });
  } catch (err) {
    if (err instanceof AiQuotaError) return quotaExceededResponse();
    console.error("[dish-image] failed pet-bowl:", bowl.id, err instanceof Error ? err.message : err);
    return Response.json({ error: "Bowl photo is not available right now." }, { status: 502 });
  }
}
