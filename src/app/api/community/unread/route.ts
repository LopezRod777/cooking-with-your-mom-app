import { requireUser } from "../../../../lib/auth/requireUser";
import * as db from "../../../../lib/community/db";

const NO_STORE = { "Cache-Control": "private, no-store" };

// GET ?since=<ISO>: how many messages from other people landed since then. { count: 0 } while the tables are missing.
export async function GET(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const raw = new URL(req.url).searchParams.get("since");
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  try {
    const me = await db.me(u.userId);
    if (me === "not_migrated" || me?.status === "banned") return Response.json({ count: 0 }, { headers: NO_STORE });
    return Response.json({ count: await db.unreadCount(u.userId, since) }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof Error && /relation .* does not exist/i.test(err.message)) return Response.json({ count: 0 }, { headers: NO_STORE });
    throw err;
  }
}
