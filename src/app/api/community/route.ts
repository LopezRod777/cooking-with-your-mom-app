import { del } from "@vercel/blob";
import { z } from "zod";
import { requireUser, sameOrigin } from "../../../lib/auth/requireUser";
import { reserveAiQuota } from "../../../lib/ai/dailyQuota";
import * as db from "../../../lib/community/db";
import { DAILY_BUDGET, combineVerdicts, moderateText, type Verdict } from "../../../lib/community/moderate";
import { blockedWord } from "../../../lib/community/words";
import { Recipe } from "../../../lib/schemas";

// Letters (any script), spaces, apostrophes, periods and hyphens; starts with a letter; 2 to 24 characters.
const NAME_SHAPE = /^\p{L}[\p{L}\p{M} '’.-]{1,23}$/u;

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const notMigrated = (err: unknown) => err instanceof Error && /relation .* does not exist/i.test(err.message);

// A photo staged as "review" carries this suffix in its DB key only; the blob key never has it.
const REVIEW_SUFFIX = "#review";
const bareKey = (k: string) => k.replace(/#review$/, "");
const OUR_BLOB_HOST = ".public.blob.vercel-storage.com";
// A step photo URL is kept only when it is on our blob host; anything else (or a bad URL) is dropped.
function ownBlobUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).hostname.endsWith(OUR_BLOB_HOST) ? url : undefined;
  } catch {
    return undefined;
  }
}

// Blobs of deleted posts and photos: best effort, a key that is already gone is not an error.
async function removeBlobs(keys: string[]): Promise<void> {
  const token = process.env.PETS_READ_WRITE_TOKEN;
  const list = keys.filter(Boolean).map(bareKey);
  if (!token || list.length === 0) return;
  await del(list, { token }).catch((err) =>
    console.warn("[community] blob delete failed", err instanceof Error ? err.message : String(err)),
  );
}

// GET: who I am at the table + the feed. { pending: true } until the tables exist.
export async function GET() {
  const u = await requireUser();
  if (u instanceof Response) return u;
  try {
    const me = await db.me(u.userId);
    if (me === "not_migrated") return json({ pending: true });
    if (me?.status === "banned") return json({ error: "banned" }, 403);
    await db.ensureWelcome();
    const [posts, items, pinnedNote] = await Promise.all([db.feed(u.userId), db.timeline(u.userId), db.pinned()]);
    return json({ me, posts, items, pinned: pinnedNote });
  } catch (err) {
    if (notMigrated(err)) return json({ pending: true });
    throw err;
  }
}

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("name"), name: z.string().trim().min(2).max(db.NAME_MAX) }),
  // Text may be empty only when a photo is attached.
  z
    .object({ kind: z.literal("post"), text: z.string().trim().max(db.POST_MAX), photoId: z.uuid().optional() })
    .refine((p) => p.text.length > 0 || p.photoId !== undefined, { message: "text_or_photo" }),
  z.object({ kind: z.literal("recipe"), recipeId: z.string().min(1).max(64), text: z.string().trim().max(db.POST_MAX).optional() }),
  z.object({ kind: z.literal("comment"), postId: z.uuid(), text: z.string().trim().min(1).max(db.COMMENT_MAX) }),
  z.object({ kind: z.literal("heart"), postId: z.uuid() }),
  z.object({ kind: z.literal("report"), target: z.enum(["post", "comment"]), id: z.uuid(), reason: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal("delete"), target: z.enum(["post", "comment"]), id: z.uuid() }),
]);

type RecipeBody = Extract<z.infer<typeof Body>, { kind: "recipe" }>;

// Per-person cap first, then the shared daily budget; false sends the content to review instead of the classifier.
const spendFor = (userId: string) => async () => (await reserveAiQuota(userId, "moderation")) && db.spendModeration(DAILY_BUDGET);

// A recipe is copied from the author's own saved state (never from the client) and moderated as public text.
async function shareRecipe(userId: string, b: RecipeBody): Promise<Response> {
  const raw = await db.sharedRecipeForAuthor(userId, b.recipeId);
  if (!raw) return json({ error: "recipe_missing" }, 404);
  const parsed = Recipe.safeParse(raw);
  if (!parsed.success) return json({ error: "recipe_invalid" }, 422);
  const recipe = parsed.data;
  // Only our own public blob host may be kept as an image; anything else is dropped.
  // kidNote and plateNote stay at home: they are written for one table and are not part of the moderated text.
  const { imageUrl, kidNote, plateNote, ...withoutImage } = recipe;
  void kidNote;
  void plateNote;
  const safe = imageUrl && new URL(imageUrl).hostname.endsWith(OUR_BLOB_HOST) ? { ...withoutImage, imageUrl } : withoutImage;
  // Step photos follow the same rule: kept only from our blob host.
  const safeSteps = safe.steps.map((s) => {
    const { imageUrl: stepUrl, ...rest } = s;
    return ownBlobUrl(stepUrl) ? { ...rest, imageUrl: stepUrl } : rest;
  });
  const sharedRecipe = { ...safe, steps: safeSteps };

  const recipeText = [
    recipe.title,
    recipe.momTip ?? "",
    ...recipe.steps.map((s) => s.text),
    ...recipe.ingredients.map((i) => i.display),
  ].join("\n");
  const recipeV = await moderateText(recipeText, { spend: spendFor(userId) });
  if (recipeV.decision === "block") return json({ error: "blocked", care: recipeV.category === "self_harm" }, 422);
  const textV = b.text ? await moderateText(b.text, { spend: spendFor(userId) }) : null;
  if (textV?.decision === "block") return json({ error: "blocked", care: textV.category === "self_harm" }, 422);

  const state = combineVerdicts(recipeV, textV) === "ok" ? "visible" : "review";
  const recipeRowId = await db.insertSharedRecipe(userId, sharedRecipe);
  const id = await db.insertPost(userId, textV?.text ?? "", state, recipeV.note ?? textV?.note ?? null, { recipeId: recipeRowId });
  if (!id) return json({ error: "slow_down" }, 429);
  return json({ id, state });
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const b = parsed.data;
  try {
    const me = await db.me(u.userId);
    if (me === "not_migrated") return json({ error: "pending" }, 503);
    if (me?.status === "banned") return json({ error: "banned" }, 403);

    if (b.kind === "name") {
      // A name is letters, not a message: shape check + the blocked-word list. The classifier is for sentences and
      // turned plain names away ("QA Ana" came back as spam), so it is not asked here.
      if (!NAME_SHAPE.test(b.name) || blockedWord(b.name)) return json({ error: "name_rejected" }, 422);
      return json({ me: await db.setName(u.userId, b.name.replace(/\s+/g, " ")) });
    }
    if (b.kind === "heart") {
      const r = await db.toggleHeart(u.userId, b.postId);
      return r ? json(r) : json({ error: "missing" }, 404);
    }
    if (b.kind === "delete") {
      const r = await db.deleteOwn(u.userId, b.target, b.id);
      if (!r.ok) return json({ error: "missing" }, 404);
      await removeBlobs(r.keys);
      return json({ ok: true });
    }
    if (b.kind === "report") {
      if (!me) return json({ error: "name_needed" }, 409);
      const outcome = await db.report(u.userId, b.target, b.id, b.reason);
      return json({ outcome }, outcome === "missing" ? 404 : 200);
    }
    // recipe / post / comment
    if (!me) return json({ error: "name_needed" }, 409);
    if (me.status === "muted") return json({ error: "muted" }, 403);
    // Atomic per-person cap on every write (recipe, comment, post) before any moderation is spent.
    if (!(await reserveAiQuota(u.userId, "community-write"))) return json({ error: "slow_down" }, 429);
    if (b.kind === "recipe") return shareRecipe(u.userId, b);

    if (b.kind === "comment") {
      const v = await moderateText(b.text, { spend: spendFor(u.userId) });
      if (v.decision === "block") return json({ error: "blocked", care: v.category === "self_harm" }, 422);
      const state = v.decision === "ok" ? "visible" : "review";
      const id = await db.insertComment(u.userId, b.postId, v.text, state, v.note ?? null);
      if (!id) return json({ error: "slow_down" }, 429);
      return json({ id, state, care: v.category === "self_harm" });
    }

    // post (text, photo, or both). Text is checked before the photo is claimed, so a blocked post leaves the photo
    // staged for a retry.
    const textV: Verdict | null = b.text ? await moderateText(b.text, { spend: spendFor(u.userId) }) : null;
    if (textV?.decision === "block") return json({ error: "blocked", care: textV.category === "self_harm" }, 422);
    const photo = b.photoId ? await db.claimPhoto(b.photoId, u.userId) : null;
    if (b.photoId && !photo) return json({ error: "photo_missing" }, 404);
    const photoV = photo ? { decision: photo.key.endsWith(REVIEW_SUFFIX) ? ("review" as const) : ("ok" as const) } : null;
    const state = combineVerdicts(textV ?? { decision: "ok" }, photoV) === "ok" ? "visible" : "review";
    const note = [textV?.note, photoV?.decision === "review" ? "photo: review" : null].filter(Boolean).join("; ") || null;
    const id = await db.insertPost(u.userId, textV?.text ?? "", state, note, { photoId: b.photoId ?? null });
    if (!id) return json({ error: "slow_down" }, 429);
    return json({ id, state, care: textV?.category === "self_harm" });
  } catch (err) {
    if (notMigrated(err)) return json({ error: "pending" }, 503);
    throw err;
  }
}
