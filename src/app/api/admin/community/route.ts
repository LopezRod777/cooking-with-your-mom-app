import { del } from "@vercel/blob";
import { z } from "zod";
import { requireAdmin, sameOrigin } from "../../../../lib/auth/requireUser";
import * as db from "../../../../lib/community/db";

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

// Blobs freed by an admin action (ban): best effort, same private store as the community photos.
async function removeBlobs(keys: string[]): Promise<void> {
  const token = process.env.PETS_READ_WRITE_TOKEN;
  const list = keys.filter(Boolean).map((k) => k.replace(/#review$/, ""));
  if (!token || list.length === 0) return;
  await del(list, { token }).catch((err) =>
    console.warn("[admin/community] blob delete failed", err instanceof Error ? err.message : String(err)),
  );
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return json({ error: "not_found" }, admin.status);
  try {
    return json({ queue: await db.queue() });
  } catch (err) {
    if (err instanceof Error && /relation .* does not exist/i.test(err.message)) return json({ queue: [], pending: true });
    throw err;
  }
}

const Body = z.object({ kind: z.enum(["post", "comment"]), id: z.uuid(), action: z.enum(["show", "hide", "mute", "ban", "restore_member"]) });

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return json({ error: "not_found" }, admin.status);
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const r = await db.act(admin.userId, parsed.data.kind, parsed.data.id, parsed.data.action);
  await removeBlobs(r.keys);
  return json({ ok: r.ok }, r.ok ? 200 : 404);
}
