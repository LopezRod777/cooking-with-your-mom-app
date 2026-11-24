// Cookie del gate 21+. El valor es base64url(sessionId) + "." + HMAC-SHA256 hex; el nonce vive en
// la fila de pairing_unlocks, así que borrar la fila revoca la cookie sin esperar a que expire.
import { createHmac, timingSafeEqual } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { getUnlock } from "./db";

export const COOKIE = "cwym_over21";

function secret(): string {
  const s = process.env.PAIRINGS_COOKIE_SECRET;
  if (!s) throw new Error("PAIRINGS_COOKIE_SECRET is not set");
  return s;
}

function mac(userId: string, sessionId: string, nonce: string): string {
  return createHmac("sha256", secret()).update(`${userId}:${sessionId}:${nonce}`).digest("hex");
}

export function signUnlock(userId: string, sessionId: string, nonce: string): string {
  return `${Buffer.from(sessionId, "utf8").toString("base64url")}.${mac(userId, sessionId, nonce)}`;
}

export function verifyUnlockCookie(
  cookieValue: string | undefined | null,
  userId: string,
  sessionId: string,
  nonceFromDb: string | null | undefined,
): boolean {
  if (!cookieValue || !nonceFromDb) return false;
  const expected = signUnlock(userId, sessionId, nonceFromDb);
  const a = Buffer.from(cookieValue, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function cookieAttributes() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: "/",
  };
}

const LOCKED = { error: "locked" };

// Verifica el gate para la sesión actual. Devuelve { userId } o un 403 locked.
// Quien llame debe haber pasado requireUser antes; aquí solo se comprueba el desbloqueo.
export async function requirePairingsGate(): Promise<{ userId: string } | Response> {
  const { userId, sessionId } = await auth();
  if (!userId || !sessionId) return Response.json(LOCKED, { status: 403, headers: { "Cache-Control": "private, no-store" } });

  const jar = await cookies();
  const value = jar.get(COOKIE)?.value;
  const row = value ? await getUnlock(userId) : null;
  if (!row || row.session_id !== sessionId || !verifyUnlockCookie(value, userId, sessionId, row.nonce)) {
    return Response.json(LOCKED, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  return { userId };
}
