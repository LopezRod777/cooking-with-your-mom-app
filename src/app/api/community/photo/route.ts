// Table photos: a PRIVATE Vercel Blob under community/<photoId>.jpg, on the pets' private store. The key is never
// taken from the client, and the bytes are re-encoded here (sharp), so no EXIF (GPS, device) is ever stored.
// A photo whose verdict is "review" is staged with a "#review" suffix on its DB key only (never in the blob key);
// the post route reads that suffix to hide the post, and every blob call strips it first.
import { del, put } from "@vercel/blob";
import sharp from "sharp";
import { requireUser, sameOrigin } from "../../../../lib/auth/requireUser";
import { reserveAiQuota } from "../../../../lib/ai/dailyQuota";
import * as db from "../../../../lib/community/db";
import { DAILY_BUDGET, moderateImage } from "../../../../lib/community/moderate";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const REQUEST_MAX_BYTES = 2_500_000;
const FILE_MAX_BYTES = 2_000_000;
const INPUT_MAX_SIDE = 6000;
const INPUT_MAX_PIXELS = 24_000_000;
const REVIEW_SUFFIX = "#review";
const bareKey = (k: string) => k.replace(/#review$/, "");

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const token = process.env.PETS_READ_WRITE_TOKEN;
  if (!token) return json({ error: "photo_store_unconfigured" }, 500);

  // Refuse oversized bodies before formData() reads them.
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > REQUEST_MAX_BYTES) return json({ error: "too_large" }, 413);

  // Atomic attempt reservation before the body is read: every attempt counts against the daily cap.
  if (!(await reserveAiQuota(u.userId, "community-photo"))) return json({ error: "slow_down" }, 429);
  const photoId = await db.reservePhotoAttempt(u.userId);
  if (!photoId) return json({ error: "slow_down" }, 429);
  const expired = await db.expireStaged(u.userId);
  const expiredKeys = expired.filter(Boolean).map(bareKey);
  if (expiredKeys.length) await del(expiredKeys, { token }).catch(() => {});

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return json({ error: "no_file" }, 400);
  if (!ACCEPTED_TYPES.has(file.type)) return json({ error: "unsupported_type" }, 415);
  if (file.size > FILE_MAX_BYTES) return json({ error: "too_large" }, 413);

  let jpeg: Buffer;
  let w: number;
  let h: number;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const source = sharp(input, { limitInputPixels: INPUT_MAX_PIXELS, failOn: "error" });
    const meta = await source.metadata();
    if ((meta.width ?? 0) > INPUT_MAX_SIDE || (meta.height ?? 0) > INPUT_MAX_SIDE) {
      return json({ error: "too_large_dimensions" }, 413);
    }
    const out = await source
      .rotate()
      .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    jpeg = out.data;
    w = out.info.width;
    h = out.info.height;
  } catch {
    await db.markPhotoBlocked(photoId, u.userId);
    return json({ error: "invalid_image" }, 415);
  }

  const verdict = await moderateImage(jpeg, { spend: async () => (await reserveAiQuota(u.userId, "moderation")) && db.spendModeration(DAILY_BUDGET) });
  if (verdict.decision === "block") {
    await db.markPhotoBlocked(photoId, u.userId);
    return json({ error: "blocked", category: verdict.category }, 422);
  }

  const key = `community/${photoId}.jpg`;
  await put(key, jpeg, {
    token,
    access: "private",
    contentType: "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  await db.stagePhoto(photoId, u.userId, verdict.decision === "ok" ? key : `${key}${REVIEW_SUFFIX}`, w, h);
  return json({ photoId, w, h, state: verdict.decision === "ok" ? "ok" : "review", note: verdict.note });
}
