import { z } from "zod";
import { requireUser } from "../../../../lib/auth/requireUser";
import * as db from "../../../../lib/community/db";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const post = z.uuid().safeParse(new URL(req.url).searchParams.get("post"));
  if (!post.success) return Response.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  const me = await db.me(u.userId);
  if (me === "not_migrated") return Response.json({ comments: [] }, { headers: NO_STORE });
  if (me?.status === "banned") return Response.json({ error: "banned" }, { status: 403, headers: NO_STORE });
  return Response.json({ comments: await db.comments(u.userId, post.data) }, { headers: NO_STORE });
}
