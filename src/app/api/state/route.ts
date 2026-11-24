import { z } from "zod";
import { getSql } from "../../../lib/db";
import { otherAccount } from "../../../lib/auth/account";
import { requireUser } from "../../../lib/auth/requireUser";
import { AppStateWire } from "../../../lib/schemas";

export const maxDuration = 30;

const MAX_BODY = 524288;

const AppStateBounded = AppStateWire.refine((s) => s.favorites.length <= 300, {
  message: "favorites: máximo 300",
  path: ["favorites"],
})
  .refine((s) => Object.keys(s.favoriteRecipes).length <= 300, {
    message: "favoriteRecipes: máximo 300",
    path: ["favoriteRecipes"],
  })
  .refine((s) => s.plan === null || s.plan.days.length <= 8, {
    message: "plan.days: máximo 8",
    path: ["plan", "days"],
  });

const PutBody = z.object({
  baseRevision: z.number().int().min(0),
  state: AppStateBounded,
});

type StateRow = { revision: number; state: unknown; updated_at: unknown };

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

async function currentRow(userId: string) {
  const rows = (await getSql().query(
    "select revision, state, updated_at from app_state where user_id = $1",
    [userId],
  )) as StateRow[];
  const row = rows[0];
  if (!row) return { revision: 0, state: null, updatedAt: null };
  return { revision: row.revision, state: row.state, updatedAt: iso(row.updated_at) };
}

export async function GET(req?: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const wrong = req ? otherAccount(req.headers, u.userId) : null;
  if (wrong) return wrong;
  return Response.json(await currentRow(u.userId));
}

export async function PUT(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const wrong = otherAccount(req.headers, u.userId);
  if (wrong) return wrong;
  // A tab from before this header cannot say whose data it holds. It reloads once, keeping its edits, and then it can.
  if (!req.headers.get("x-cwym-user")) return Response.json({ error: "outdated_client" }, { status: 400 });

  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PutBody.safeParse(json);
  if (!parsed.success) {
    // A client that predates schema 5 (schema 4 or older, or no `pets`, `places` or `profile.kitchen`) must reload, not be read as a bad request.
    const sent = (json as { state?: unknown } | null)?.state;
    const sentProfile = typeof sent === "object" && sent !== null ? (sent as { profile?: unknown }).profile : undefined;
    const outdated =
      typeof sent === "object" &&
      sent !== null &&
      ((sent as { schema?: unknown }).schema !== 11 ||
        (sent as { pets?: unknown }).pets === undefined ||
        (sent as { places?: unknown }).places === undefined ||
        (typeof sentProfile === "object" && sentProfile !== null
          ? (sentProfile as { kitchen?: unknown }).kitchen === undefined ||
            (sentProfile as { mealDrinks?: unknown }).mealDrinks === undefined
          : false));
    if (outdated) {
      return Response.json({ error: "outdated_client", issues: parsed.error.issues }, { status: 400 });
    }
    return Response.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  const { baseRevision, state } = parsed.data;
  const sql = getSql();
  const payload = JSON.stringify(state);

  if (baseRevision === 0) {
    const rows = (await sql.query(
      "insert into app_state (user_id, revision, state) values ($1, 1, $2) on conflict (user_id) do nothing returning revision, updated_at",
      [u.userId, payload],
    )) as Array<{ revision: number; updated_at: unknown }>;
    if (rows[0]) {
      return Response.json({ revision: rows[0].revision, updatedAt: iso(rows[0].updated_at) });
    }
  } else {
    const rows = (await sql.query(
      "update app_state set state = $3, revision = revision + 1, updated_at = now() where user_id = $1 and revision = $2 returning revision, updated_at",
      [u.userId, baseRevision, payload],
    )) as Array<{ revision: number; updated_at: unknown }>;
    if (rows[0]) {
      return Response.json({ revision: rows[0].revision, updatedAt: iso(rows[0].updated_at) });
    }
  }

  const current = await currentRow(u.userId);
  return Response.json({ error: "conflict", ...current }, { status: 409 });
}
