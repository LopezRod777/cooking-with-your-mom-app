import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { firstSeen, getMember, type Member } from "./members";
import { notifyNewMember } from "../email/newMember";

// Who gets in (decided per request, in this order):
//   1. No session → 401.
//   2. A `members` row with status blocked → 403 blocked. Wins over the invite list and over the mode.
//   3. Verified primary email on ALLOWED_EMAILS or ADMIN_EMAILS → in.
//   4. SIGNUP_MODE invite (default, and for any unknown value) → 403 not_invited.
//      waitlist → first sight creates a waiting row; approved rows get in; others 403 waiting.
//      open → first sight creates an approved row; in.
// Only positive decisions are cached, for 20 s per instance, so an approval or a block lands on the next request
// everywhere within 20 s.

const TTL_MS = 20 * 1000; // a block or an approval lands on the next request within 20 s on every instance
export const REF_COOKIE = "cwym_ref";

export type SignupMode = "invite" | "waitlist" | "open";
export type Denial = "not_invited" | "waiting" | "blocked";

type CacheEntry = { email: string; exp: number };
const cache = new Map<string, CacheEntry>();
let warnedEmptyList = false;

export function signupMode(): SignupMode {
  const m = (process.env.SIGNUP_MODE ?? "invite").trim().toLowerCase();
  return m === "waitlist" || m === "open" ? m : "invite";
}

export function isAllowedEmail(email: string, list: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export function isAdminEmail(email: string): boolean {
  return isAllowedEmail(email, process.env.ADMIN_EMAILS ?? "");
}

export function _resetRequireUserCache(): void {
  cache.clear();
  warnedEmptyList = false;
}

function deny(reason: Denial): Response {
  return Response.json({ error: reason }, { status: 403 });
}

async function refFromCookie(): Promise<string | null> {
  try {
    const v = (await cookies()).get(REF_COOKIE)?.value ?? "";
    return /^[a-z0-9-]{1,32}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<{ userId: string; email: string } | Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.exp > now) return { userId, email: hit.email };

  const mode = signupMode();
  const list = process.env.ALLOWED_EMAILS ?? "";
  if (mode === "invite" && !list.split(",").some((e) => e.trim())) {
    if (!warnedEmptyList) {
      warnedEmptyList = true;
      console.warn("[auth] ALLOWED_EMAILS is empty: nobody is allowed");
    }
    return deny("not_invited");
  }

  // Clerk and the member row in parallel: both are needed on every cache miss, and a PUT should not wait twice.
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  let found: Member | null = null;
  try {
    [user, found] = await Promise.all([currentUser(), getMember(userId)]);
  } catch (err) {
    console.warn("[auth] lookup failed", err instanceof Error ? err.message : String(err));
    return Response.json({ error: "auth_unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" } });
  }
  // A valid session whose user Clerk cannot return right now is a hiccup, not a stranger: 503 so clients retry
  // instead of showing a closed door (2026-11-04: a member saw "not open to you" plus "couldn't sync" at once).
  if (!user) return Response.json({ error: "auth_unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" } });
  const primary = user.primaryEmailAddress;
  const verified = primary?.verification?.status === "verified";
  const email = verified ? primary.emailAddress.trim().toLowerCase() : "";
  if (!email) return deny("not_invited");

  // A block is a block, for invitees and admins too.
  let member: Member | null = found;
  if (member?.status === "blocked") return deny("blocked");

  const admit = () => {
    cache.set(userId, { email, exp: now + TTL_MS });
    return { userId, email };
  };

  if (isAllowedEmail(email, list) || isAdminEmail(email)) return admit();
  if (mode === "invite") return deny("not_invited");

  let created = false;
  if (!member) {
    const seen = await firstSeen(userId, email, mode === "open" ? "approved" : "waiting", await refFromCookie());
    member = seen.member;
    created = seen.created;
  }
  // Fire-and-forget: the mail never delays the answer and a failure never changes the decision below.
  if (created && member.status === "waiting") {
    void notifyNewMember({ email, ref: member.ref, userId })
      .then((r) => { if (!r.sent) console.warn(`[auth] new-member notice not sent for ${userId}: ${r.reason}`); })
      .catch(() => {});
  }
  if (member.status === "approved" || (mode === "open" && member.status === "waiting")) return admit();
  return deny(member.status === "blocked" ? "blocked" : "waiting");
}

// Admin: a signed-in, verified email on ADMIN_EMAILS. Does not depend on the member row (bootstrap), except that a
// blocked admin stays out. 404 for everyone else: the page does not exist for them.
export async function requireAdmin(): Promise<{ userId: string; email: string } | Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const user = await currentUser();
  const primary = user?.primaryEmailAddress;
  const verified = primary?.verification?.status === "verified";
  const email = verified ? primary.emailAddress.trim().toLowerCase() : "";
  if (!email || !isAdminEmail(email)) return Response.json({ error: "not_found" }, { status: 404 });
  const member = await getMember(userId);
  if (member?.status === "blocked") return Response.json({ error: "not_found" }, { status: 404 });
  return { userId, email };
}

// State-changing admin calls must come from our own page: same-origin fetch (Sec-Fetch-Site) or a matching Origin.
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>([new URL(req.url).origin]);
  if (process.env.NEXT_PUBLIC_APP_ORIGIN) allowed.add(process.env.NEXT_PUBLIC_APP_ORIGIN);
  return allowed.has(origin);
}
