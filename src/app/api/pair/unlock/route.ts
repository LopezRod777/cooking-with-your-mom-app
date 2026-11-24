import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/auth/requireUser";
import { COOKIE, cookieAttributes, signUnlock } from "../../../../lib/pairings/cookie";
import { createUnlock } from "../../../../lib/pairings/db";

const NO_STORE = "private, no-store";

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) {
    u.headers.set("Cache-Control", NO_STORE);
    return u;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: { "Cache-Control": NO_STORE } });
  }
  if (!body || typeof body !== "object" || (body as { confirm?: unknown }).confirm !== true) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: { "Cache-Control": NO_STORE } });
  }

  const { sessionId } = await auth();
  if (!sessionId) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": NO_STORE } });
  }

  const nonce = await createUnlock(u.userId, sessionId);
  const res = NextResponse.json({ unlocked: true }, { headers: { "Cache-Control": NO_STORE } });
  res.cookies.set(COOKIE, signUnlock(u.userId, sessionId, nonce), cookieAttributes());
  return res;
}
