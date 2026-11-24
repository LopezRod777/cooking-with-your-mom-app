import { readJsonCapped } from "../../../lib/http/readJsonCapped";
import { reserveSharedQuota } from "../../../lib/ai/dailyQuota";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSql } from "../../../lib/db";
import { requireUser } from "../../../lib/auth/requireUser";
import { requirePairingsGate } from "../../../lib/pairings/cookie";
import {
  claimInflight,
  getPairing,
  releaseInflight,
  renewInflight,
  reserveQuota,
  savePairing,
} from "../../../lib/pairings/db";
import { anthropic, MODEL } from "../../../lib/ai/client";
import { aiErrorResponse } from "../../../lib/ai/http";
import {
  buildPairingPrompt,
  PAIRING_MAX_TOKENS,
  PAIRING_OUTPUT_CONFIG,
  RECIPE_JSON_MAX_BYTES,
} from "../../../lib/pairings/prompt";
import { validatePairing } from "../../../lib/pairings/validate";
import type { PairingOutput } from "../../../lib/pairings/schema";
import { Recipe } from "../../../lib/schemas";

export const maxDuration = 60;

const MODEL_TIMEOUT_MS = 25_000;
const LEASE_RENEW_MS = 10_000;
const ATTEMPTS = 2;

const Body = z.object({ recipeId: z.string().min(1).max(120) });

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

function own(obj: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

// The recipe lives in the account's state: this week's plan first, then favorites. Reads the stored JSON
// loosely (no AppState parse), so a schema bump does not break pairings.
async function findRecipe(userId: string, recipeId: string): Promise<Recipe | null> {
  const rows = (await getSql().query("select state from app_state where user_id = $1", [userId])) as Array<{
    state: unknown;
  }>;
  let state: unknown = rows[0]?.state;
  if (typeof state === "string") {
    try {
      state = JSON.parse(state);
    } catch {
      return null;
    }
  }
  if (!state || typeof state !== "object") return null;
  const plan = own(state, "plan");
  const plannedRecipes = plan && typeof plan === "object" ? own(plan, "recipes") : undefined;
  const favorites = own(state, "favoriteRecipes");
  const candidate =
    (plannedRecipes && typeof plannedRecipes === "object" ? own(plannedRecipes, recipeId) : undefined) ??
    (favorites && typeof favorites === "object" ? own(favorites, recipeId) : undefined);
  const parsed = Recipe.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// The only recipe fields the model sees: enough to pick a drink, nothing it could follow as instructions.
function recipeJsonOf(r: Recipe): string {
  return JSON.stringify({
    title: r.title,
    cuisine: r.cuisine,
    slot: r.slot,
    servings: r.servings,
    ingredients: r.ingredients.map((i) => ({ key: i.key, display: i.display })),
  });
}

// First complete {...} object in the text, honoring strings. Undefined when there is none or it does not parse.
function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

type Attempt =
  | { kind: "ok"; value: PairingOutput; lowConfidence: boolean }
  | { kind: "invalid" }
  | { kind: "lease_lost" };

// One model call. The lease is renewed while the model works; if a renewal fails, the call is aborted and nothing is saved.
async function askModel(userId: string, owner: string, system: string, user: string): Promise<Attempt> {
  const ctrl = new AbortController();
  let leaseLost = false;
  const loseLease = () => {
    leaseLost = true;
    ctrl.abort();
  };
  const timeout = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);
  const renew = setInterval(() => {
    renewInflight(userId, owner).then((ok) => {
      if (!ok) loseLease();
    }, loseLease);
  }, LEASE_RENEW_MS);
  try {
    const resp = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: PAIRING_MAX_TOKENS,
        output_config: PAIRING_OUTPUT_CONFIG,
        system,
        messages: [{ role: "user", content: user }],
      },
      // maxRetries: 0 so each network attempt is exactly one reserved quota (the loop in POST reserves before each call).
      { signal: ctrl.signal, maxRetries: 0 },
    );
    if (leaseLost) return { kind: "lease_lost" };
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const checked = validatePairing(firstJsonObject(text));
    if (!checked.ok) return { kind: "invalid" };
    return { kind: "ok", value: checked.value, lowConfidence: checked.lowConfidence };
  } catch (err) {
    if (leaseLost) return { kind: "lease_lost" };
    throw err;
  } finally {
    clearTimeout(timeout);
    clearInterval(renew);
  }
}

export async function POST(req: Request): Promise<Response> {
  const u = await requireUser();
  if (u instanceof Response) return noStore(u);

  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) return reply({ error: "bad_request" }, 400);
  const { recipeId } = parsed.data;

  const gate = await requirePairingsGate();
  if (gate instanceof Response) return gate;

  const recipe = await findRecipe(u.userId, recipeId);
  if (!recipe) return reply({ error: "unknown_recipe" }, 404);

  const recipeJson = recipeJsonOf(recipe);
  if (new TextEncoder().encode(recipeJson).length > RECIPE_JSON_MAX_BYTES) {
    return reply({ error: "recipe_too_large" }, 422);
  }

  const owner = randomUUID();
  if (!(await claimInflight(u.userId, owner))) return reply({ error: "busy" }, 409);

  try {
    const { system, user } = buildPairingPrompt(recipeJson);
    let chosen: PairingOutput | null = null;
    for (let attempt = 0; attempt < ATTEMPTS && chosen === null; attempt++) {
      const quota = await reserveQuota(u.userId);
      if (quota === null || !(await reserveSharedQuota("pairing"))) return reply({ error: "quota" }, 429);

      let outcome: Attempt;
      try {
        outcome = await askModel(u.userId, owner, system, user);
      } catch (err) {
        return noStore(aiErrorResponse(err));
      }
      if (outcome.kind === "lease_lost") return reply({ error: "lease_lost" }, 409);
      if (outcome.kind === "invalid") continue;
      // A low-confidence answer is not retried and not saved.
      if (outcome.lowConfidence) return reply({ error: "no_confident_pairing" }, 422);
      chosen = outcome.value;
    }
    if (chosen === null) return reply({ error: "no_confident_pairing" }, 422);

    // The gate may have closed while the model worked (lock, sign-out, another session): nothing is saved then.
    const recheck = await requirePairingsGate();
    if (recheck instanceof Response) return recheck;

    const createdAt = new Date().toISOString();
    const saved = await savePairing(u.userId, recipeId, { pairing: chosen, createdAt }, owner);
    if (saved === "lease_lost") return reply({ error: "lease_lost" }, 409);
    return reply({ recipeId, pairing: chosen, createdAt });
  } finally {
    await releaseInflight(u.userId, owner).catch((err) => {
      console.error("[pair] releaseInflight failed", err);
    });
  }
}

export async function GET(req: Request): Promise<Response> {
  const u = await requireUser();
  if (u instanceof Response) return noStore(u);

  const gate = await requirePairingsGate();
  if (gate instanceof Response) return gate;

  const recipeId = new URL(req.url).searchParams.get("recipeId");
  if (!recipeId || recipeId.length > 120) return reply({ error: "bad_request" }, 400);

  // Same lookup as POST: a saved pairing for a recipe that is no longer in the plan or favorites is not returned.
  const recipe = await findRecipe(u.userId, recipeId);
  if (!recipe) return reply({ error: "unknown_recipe" }, 404);

  const row = (await getPairing(u.userId, recipeId)) as { pairing?: unknown; createdAt?: unknown } | null;
  if (!row || typeof row !== "object") return reply({ error: "not_found" }, 404);
  return reply({ recipeId, pairing: row.pairing, createdAt: row.createdAt });
}
