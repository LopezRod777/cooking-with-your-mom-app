// Save of a pet with a staged photo: copies the owner's draft to the final key, then drops the draft.
import { BlobNotFoundError, del, get, put } from "@vercel/blob";
import { requireUser } from "../../../../../lib/auth/requireUser";
import { PET_ID_PATTERN, draftKey, photoKey } from "../../../../../lib/pets/photo";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const token = process.env.PETS_READ_WRITE_TOKEN || null;
  if (!token) return json({ error: "photo_store_unconfigured" }, 500);

  const body = (await req.json().catch(() => null)) as { petId?: unknown } | null;
  const petId = typeof body?.petId === "string" && PET_ID_PATTERN.test(body.petId) ? body.petId : null;
  if (!petId) return json({ error: "invalid_pet" }, 400);

  const staged = draftKey(u.userId, petId);
  let result: Awaited<ReturnType<typeof get>> = null;
  try {
    result = await get(staged, { access: "private", token, useCache: false });
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
  if (!result || result.statusCode !== 200) return json({ error: "no_draft" }, 404);

  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  const key = photoKey(u.userId, petId);
  await put(key, bytes, {
    token,
    access: "private",
    contentType: "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  try {
    await del(staged, { token });
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
  return Response.json({ key, updatedAt: new Date().toISOString() });
}
