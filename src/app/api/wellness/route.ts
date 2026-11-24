import { z } from "zod";
import { requireUser, sameOrigin } from "../../../lib/auth/requireUser";
import { DEVICE_BRANDS, clearWellness, getDevice, setDevice, summary, upsertDays } from "../../../lib/wellness/db";
import { parseWellnessText } from "../../../lib/wellness/parse";

const NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_TEXT = 2_000_000; // ~2 MB of CSV/JSON: a year of daily rows is far smaller

// GET: the person's own summary + chosen device, or { pending: true } until the tables exist.
export async function GET() {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const [s, d] = await Promise.all([summary(u.userId), getDevice(u.userId)]);
  // Tables not there yet: a quiet 200 (no console error on every Settings visit), the card shows one line.
  if (s === "not_migrated" || d === "not_migrated") return Response.json({ pending: true }, { headers: NO_STORE });
  return Response.json({ summary: s, device: d }, { headers: NO_STORE });
}

const Body = z.union([
  z.object({ kind: z.literal("upload"), text: z.string().min(1).max(MAX_TEXT) }),
  z.object({ kind: z.literal("device"), brand: z.enum(DEVICE_BRANDS).nullable() }),
]);

// POST: an export file's text (parsed here, only weight / sleep / resting HR kept) or the device choice.
export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  try {
    if (parsed.data.kind === "device") {
      await setDevice(u.userId, parsed.data.brand);
      return Response.json({ ok: true }, { headers: NO_STORE });
    }
    const result = parseWellnessText(parsed.data.text);
    if (result.days.length === 0) {
      return Response.json({ error: "nothing_found", columns: result.columns, skipped: result.skipped }, { status: 422, headers: NO_STORE });
    }
    const saved = await upsertDays(u.userId, result.days);
    const s = await summary(u.userId);
    return Response.json({ saved, skipped: result.skipped, columns: result.columns, summary: s }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof Error && /relation .* does not exist/i.test(err.message)) {
      return Response.json({ error: "not_migrated" }, { status: 503, headers: NO_STORE });
    }
    throw err;
  }
}

// DELETE: everything the person shared, now.
export async function DELETE(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  await clearWellness(u.userId);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
