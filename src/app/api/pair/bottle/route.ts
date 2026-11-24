import { reserveSharedQuota } from "../../../../lib/ai/dailyQuota";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getSql } from "../../../../lib/db";
import { requireUser } from "../../../../lib/auth/requireUser";
import { requirePairingsGate } from "../../../../lib/pairings/cookie";
import {
  claimInflight,
  releaseInflight,
  renewInflight,
  reserveBottleQuota,
} from "../../../../lib/pairings/db";
import { anthropic, MODEL } from "../../../../lib/ai/client";
import {
  BOTTLE_MAX_TOKENS,
  buildBottlePrompt,
  planFingerprint,
  serveLineFor,
  servedRecipeIds,
  servedRecipesOf,
  validateBottle,
  type BottleInput,
  type BottleResult,
  type ServedRecipe,
} from "../../../../lib/pairings/bottle";
import { WeekPlan } from "../../../../lib/schemas";

export const maxDuration = 60;

const MAX_BODY_BYTES = 1_200_000;
const MAX_DECODED_BYTES = 1_500_000;
const MAX_JPEG_BYTES = 600_000;
const CALL_TIMEOUT_MS = 25_000;
const DEADLINE_MS = 55_000;
const ATTEMPTS = 2;
const BOTTLE_OUTPUT_CONFIG = { effort: "low" } as const;

const Body = z.object({
  image: z.string().min(1).optional(),
  text: z.string().trim().min(1).max(60).optional(),
  planFingerprint: z.string().regex(/^[0-9a-f]{8}$/),
});

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function own(obj: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

// Reads the stored state of the user and returns its plan, or null. Same query as the pair route's findRecipe.
async function loadPlan(userId: string): Promise<WeekPlan | null> {
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
  const parsed = WeekPlan.nullable().safeParse(own(state, "plan"));
  return parsed.success ? parsed.data : null;
}

// Reads the body while counting bytes, so a missing or false Content-Length cannot push past the limit.
async function readBody(req: Request): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

type ImageType = "jpeg" | "png" | "webp";

function imageTypeOf(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

type Prepared = { ok: true; data: string } | { ok: false; status: 413 | 415; error: string };

// Decodes, checks the magic bytes, and re-encodes to a <= 1024 px JPEG. Only that JPEG leaves the server.
async function prepareImage(base64: string): Promise<Prepared> {
  const raw = Buffer.from(base64, "base64");
  if (raw.length > MAX_DECODED_BYTES) return { ok: false, status: 413, error: "too_large" };
  if (imageTypeOf(raw) === null) return { ok: false, status: 415, error: "unsupported_type" };
  let jpeg: Buffer;
  try {
    jpeg = await sharp(raw, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return { ok: false, status: 415, error: "invalid_image" };
  }
  if (jpeg.length > MAX_JPEG_BYTES) return { ok: false, status: 413, error: "too_large" };
  return { ok: true, data: jpeg.toString("base64") };
}

function userContent(input: BottleInput, data: string | null, user: string) {
  if (input.kind === "image" && data !== null) {
    return [
      { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data } },
      { type: "text" as const, text: user },
    ];
  }
  return [{ type: "text" as const, text: user }];
}

// One model call. Provider failures, timeouts and aborts all surface as thrown errors; the caller maps them to 503.
async function callModel(
  input: BottleInput,
  data: string | null,
  recipes: ServedRecipe[],
  problems: string[] | undefined,
  signal: AbortSignal,
) {
  const { system, user } = buildBottlePrompt(input, recipes, problems);
  return anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: BOTTLE_MAX_TOKENS,
      output_config: BOTTLE_OUTPUT_CONFIG,
      system,
      messages: [{ role: "user", content: userContent(input, data, user) }],
    },
    // maxRetries: 0 so each reserved quota unit is exactly one network attempt.
    { timeout: CALL_TIMEOUT_MS, maxRetries: 0, signal },
  );
}

function providerError(err: unknown): Response {
  const status = err instanceof Anthropic.APIError ? String(err.status) : err instanceof Error ? err.name : "unknown";
  console.error(`[bottle] provider failure status=${status}`);
  return reply({ error: "unavailable" }, 503);
}

async function handle(req: Request, deadline: AbortSignal): Promise<Response> {
  const u = await requireUser();
  if (u instanceof Response) return noStore(u);
  const userId = u.userId;

  // The body is read before the gate, as the spec orders it; nothing from it is used until the gate passes.
  const raw = await readBody(req);
  if (raw === null) return reply({ error: "too_large" }, 413);
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return reply({ error: "bad_request" }, 400);
  const body = parsed.data;
  if ((body.image !== undefined) === (body.text !== undefined)) return reply({ error: "bad_request" }, 400);

  const gate = await requirePairingsGate();
  if (gate instanceof Response) return gate;

  // Recipes come only from the stored plan, never from the request.
  const plan = await loadPlan(userId);
  const ids = servedRecipeIds(plan);
  if (!plan || ids.length === 0) return reply({ error: "no_plan" }, 409);
  if (planFingerprint(ids) !== body.planFingerprint) return reply({ error: "plan_changed" }, 409);
  const recipes = servedRecipesOf(plan);

  let imageData: string | null = null;
  if (body.image !== undefined) {
    const prepared = await prepareImage(body.image);
    if (!prepared.ok) return reply({ error: prepared.error }, prepared.status);
    imageData = prepared.data;
  }
  const input: BottleInput = imageData !== null ? { kind: "image" } : { kind: "text", text: body.text ?? "" };

  const owner = randomUUID();
  if (!(await claimInflight(userId, owner))) return reply({ error: "busy" }, 409);

  try {
    let result: BottleResult | null = null;
    let problems: string[] | undefined;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (attempt === 2) {
        if (!(await renewInflight(userId, owner))) return reply({ error: "busy" }, 409);
        const recheck = await requirePairingsGate();
        if (recheck instanceof Response) return recheck;
      }
      if (deadline.aborted) return reply({ error: "unavailable" }, 503);
      const quota = await reserveBottleQuota(userId);
      if (quota === null || !(await reserveSharedQuota("bottle-scan"))) return reply({ error: "quota" }, 429);

      const started = Date.now();
      let resp: Awaited<ReturnType<typeof callModel>>;
      try {
        resp = await callModel(input, imageData, recipes, problems, deadline);
      } catch (err) {
        return providerError(err);
      }
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      console.info(
        `bottle attempt=${attempt} in=${resp.usage?.input_tokens ?? "?"} out=${resp.usage?.output_tokens ?? "?"} ms=${Date.now() - started} stop=${resp.stop_reason ?? "?"}`,
      );

      const checked = validateBottle(firstJsonObject(text), ids);
      if (checked.kind === "reject") {
        problems = checked.problems;
        continue;
      }
      // A low-confidence identification is a result, not a retry case.
      if (checked.kind === "low_confidence") {
        return imageData !== null
          ? reply({ error: "cant_read_label" }, 422)
          : reply({ error: "unknown_drink" }, 422);
      }
      result = checked.value;
      break;
    }
    if (result === null) return reply({ error: "incomplete" }, 422);

    // The gate and the plan may have changed while the model worked: nothing is returned then.
    const recheck = await requirePairingsGate();
    if (recheck instanceof Response) return recheck;
    const freshPlan = await loadPlan(userId);
    if (planFingerprint(servedRecipeIds(freshPlan)) !== body.planFingerprint) {
      return reply({ error: "plan_changed" }, 409);
    }

    return reply({
      result,
      serve: serveLineFor(result.drink.kind, result.drink.styleId),
      servedIds: ids,
    });
  } finally {
    await releaseInflight(userId, owner).catch((err) => {
      console.error("[bottle] releaseInflight failed", err);
    });
  }
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

export async function POST(req: Request): Promise<Response> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), DEADLINE_MS);
  try {
    return await handle(req, deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}
