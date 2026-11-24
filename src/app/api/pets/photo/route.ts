// Pet photos live in a PRIVATE Vercel Blob, keyed by owner + pet id. The key is never taken from the client.
// POST only stages a draft; /api/pets/photo/commit moves it to the final key when the pet is saved.
import { BlobNotFoundError, del, get, put } from "@vercel/blob";
import sharp from "sharp";
import { reserveAiQuota } from "../../../../lib/ai/dailyQuota";
import { requireUser } from "../../../../lib/auth/requireUser";
import {
  PET_ID_PATTERN,
  PHOTO_INPUT_MAX_PIXELS,
  PHOTO_INPUT_MAX_SIDE,
  PHOTO_MAX_BYTES,
  PHOTO_REQUEST_MAX_BYTES,
  PHOTO_SIZE,
  draftKey,
  photoKey,
} from "../../../../lib/pets/photo";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function petIdFrom(value: string | null): string | null {
  return value !== null && PET_ID_PATTERN.test(value) ? value : null;
}

// Pets use their own PRIVATE store. The dish images keep BLOB_READ_WRITE_TOKEN (public store).
function petsToken(): string | null {
  return process.env.PETS_READ_WRITE_TOKEN || null;
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const token = petsToken();
  if (!token) return json({ error: "photo_store_unconfigured" }, 500);
  if (!(await reserveAiQuota(u.userId, "pet-photo"))) return json({ error: "slow_down" }, 429);

  // Refuse oversized bodies before formData() reads them.
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > PHOTO_REQUEST_MAX_BYTES) return json({ error: "too_large" }, 413);

  const form = await req.formData().catch(() => null);
  const rawId = form?.get("petId");
  const petId = petIdFrom(typeof rawId === "string" ? rawId : null);
  if (!petId) return json({ error: "invalid_pet" }, 400);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "no_file" }, 400);
  if (!ACCEPTED_TYPES.has(file.type)) return json({ error: "unsupported_type" }, 415);
  if (file.size > PHOTO_MAX_BYTES) return json({ error: "too_large" }, 413);

  // Re-encode to a 512 px square JPEG so the stored bytes match the image/jpeg key and content type.
  let jpeg: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const source = sharp(input, { limitInputPixels: PHOTO_INPUT_MAX_PIXELS, failOn: "error" });
    const meta = await source.metadata();
    if ((meta.width ?? 0) > PHOTO_INPUT_MAX_SIDE || (meta.height ?? 0) > PHOTO_INPUT_MAX_SIDE) {
      return json({ error: "too_large_dimensions" }, 413);
    }
    jpeg = await source.rotate().resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    return json({ error: "invalid_image" }, 415);
  }

  const key = draftKey(u.userId, petId);
  await put(key, jpeg, {
    token,
    access: "private",
    contentType: "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return Response.json({ key, updatedAt: new Date().toISOString() });
}

export async function GET(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const token = petsToken();
  if (!token) return json({ error: "photo_store_unconfigured" }, 500);

  const url = new URL(req.url);
  const petId = petIdFrom(url.searchParams.get("petId"));
  if (!petId) return json({ error: "invalid_pet" }, 400);
  const key = url.searchParams.get("draft") === "1" ? draftKey(u.userId, petId) : photoKey(u.userId, petId);

  let result: Awaited<ReturnType<typeof get>> = null;
  try {
    // useCache: false reads origin, so a replaced photo is never served stale from the CDN.
    result = await get(key, { access: "private", token, useCache: false });
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
  if (!result || result.statusCode !== 200) return json({ error: "not_found" }, 404);

  return new Response(result.stream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
    },
  });
}

// Without draft=1 removes the saved photo AND any staged draft (Save of a removed photo, deleted pet).
// With draft=1 removes only the draft (Cancel).
export async function DELETE(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const token = petsToken();
  if (!token) return json({ error: "photo_store_unconfigured" }, 500);

  const url = new URL(req.url);
  const petId = petIdFrom(url.searchParams.get("petId"));
  if (!petId) return json({ error: "invalid_pet" }, 400);
  const keys = url.searchParams.get("draft") === "1"
    ? [draftKey(u.userId, petId)]
    : [photoKey(u.userId, petId), draftKey(u.userId, petId)];

  for (const key of keys) {
    try {
      await del(key, { token });
    } catch (err) {
      if (!(err instanceof BlobNotFoundError)) throw err;
    }
  }
  return new Response(null, { status: 204 });
}
