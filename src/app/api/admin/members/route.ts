import { clerkClient } from "@clerk/nextjs/server";
import { requireAdmin, sameOrigin } from "../../../../lib/auth/requireUser";
import { listMembers, markWelcomed, MEMBER_STATUSES, removeMember, setMemberStatus, type MemberStatus } from "../../../../lib/auth/members";
import { sendWelcome, type WelcomeResult } from "../../../../lib/email/welcome";

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return json({ error: "not_found" }, admin.status);
  const members = await listMembers();
  // Explicit shape: nothing from app_state beyond the flags.
  return json({
    members: members.map((m) => ({
      userId: m.userId,
      email: m.email,
      status: m.status,
      ref: m.ref,
      createdAt: m.createdAt,
      decidedAt: m.decidedAt,
      decidedBy: m.decidedBy,
      welcomedAt: m.welcomedAt,
      onboarded: m.onboarded,
      people: m.people,
      hasPlan: m.hasPlan,
      lastSeen: m.lastSeen,
    })),
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return json({ error: "not_found" }, admin.status);
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const { userId, status } = (body ?? {}) as { userId?: unknown; status?: unknown };
  if (typeof userId !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(userId)) return json({ error: "bad_request" }, 400);
  if (typeof status !== "string" || !MEMBER_STATUSES.includes(status as MemberStatus)) return json({ error: "bad_request" }, 400);
  const member = await setMemberStatus(userId, status as MemberStatus, admin.email);
  if (!member) return json({ error: "not_found" }, 404);
  // First approval: Mama's welcome. Once per account (welcomed_at + Resend idempotency key).
  let welcome: WelcomeResult | null = null;
  if (member.status === "approved" && !member.welcomedAt) {
    let firstName: string | null = null;
    try {
      const u = await (await clerkClient()).users.getUser(userId);
      firstName = u.firstName ?? null;
    } catch {
      firstName = null;
    }
    welcome = await sendWelcome({ to: member.email, firstName, userId });
    if (welcome.sent) {
      await markWelcomed(userId);
      member.welcomedAt = new Date().toISOString();
    } else {
      console.warn(`[admin] welcome email not sent for ${userId}: ${welcome.reason}`);
    }
  }
  return json({ member, welcome });
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return json({ error: "not_found" }, admin.status);
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!/^[A-Za-z0-9_]{1,64}$/.test(userId)) return json({ error: "bad_request" }, 400);
  const removed = await removeMember(userId);
  return json({ removed });
}
