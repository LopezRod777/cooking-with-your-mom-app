import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { COOKIE, cookieAttributes } from "../../../../lib/pairings/cookie";
import { deleteUnlock } from "../../../../lib/pairings/db";

const NO_STORE = "private, no-store";

export async function POST() {
  const { userId } = await auth();
  if (userId) await deleteUnlock(userId);

  const res = NextResponse.json({ unlocked: false }, { headers: { "Cache-Control": NO_STORE } });
  res.cookies.set(COOKIE, "", { ...cookieAttributes(), maxAge: 0 });
  return res;
}
