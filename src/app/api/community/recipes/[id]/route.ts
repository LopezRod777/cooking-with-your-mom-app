// A recipe shared to the table. Read-only, for members who can see the post that carries it.
import { z } from "zod";
import { requireUser } from "../../../../../lib/auth/requireUser";
import * as db from "../../../../../lib/community/db";

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: "not_found" }, 404);
  // Same door as the feed: a banned member does not get the recipes either.
  const me = await db.me(u.userId);
  if (me !== "not_migrated" && me?.status === "banned") return json({ error: "not_found" }, 404);
  const hit = await db.sharedRecipe(id, u.userId);
  if (!hit) return json({ error: "not_found" }, 404);
  return json(hit);
}
