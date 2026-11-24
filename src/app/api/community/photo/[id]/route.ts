// Serves one table photo from the PRIVATE blob. Visibility is decided in the DB (photoForViewer); the blob key is
// never sent to the client. A "#review" suffix on the DB key is a flag only and is stripped before the blob read.
import { BlobNotFoundError, get } from "@vercel/blob";
import { z } from "zod";
import { isAdminEmail, requireUser } from "../../../../../lib/auth/requireUser";
import * as db from "../../../../../lib/community/db";

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const bareKey = (k: string) => k.replace(/#review$/, "");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: "not_found" }, 404);
  const token = process.env.PETS_READ_WRITE_TOKEN;
  if (!token) return json({ error: "photo_store_unconfigured" }, 500);

  const hit = await db.photoForViewer(id, u.userId, isAdminEmail(u.email));
  if (!hit) return json({ error: "not_found" }, 404);

  let result: Awaited<ReturnType<typeof get>> = null;
  try {
    // useCache: false reads origin, so a replaced or removed photo is never served stale from the CDN.
    result = await get(bareKey(hit.key), { access: "private", token, useCache: false });
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
