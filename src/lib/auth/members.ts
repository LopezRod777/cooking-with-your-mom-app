import { getSql } from "../db";

export type MemberStatus = "waiting" | "approved" | "blocked";
export const MEMBER_STATUSES: readonly MemberStatus[] = ["waiting", "approved", "blocked"];

export type Member = {
  userId: string;
  email: string;
  status: MemberStatus;
  ref: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  welcomedAt: string | null;
};

// What the admin page sees per account: the member row plus flags derived from app_state. No raw state.
export type MemberRow = Member & {
  onboarded: boolean;
  people: number;
  hasPlan: boolean;
  lastSeen: string | null;
};

type Raw = {
  user_id: string;
  email: string;
  status: MemberStatus;
  ref: string | null;
  created_at: string | Date;
  decided_at: string | Date | null;
  decided_by: string | null;
  welcomed_at?: string | Date | null;
};

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());

function toMember(r: Raw): Member {
  return { userId: r.user_id, email: r.email, status: r.status, ref: r.ref, createdAt: iso(r.created_at) as string, decidedAt: iso(r.decided_at), decidedBy: r.decided_by, welcomedAt: iso(r.welcomed_at ?? null) };
}

export async function getMember(userId: string): Promise<Member | null> {
  const rows = (await getSql().query("SELECT user_id, email, status, ref, created_at, decided_at, decided_by, welcomed_at FROM members WHERE user_id = $1", [userId])) as Raw[];
  return rows[0] ? toMember(rows[0]) : null;
}

// First sight: inserts the row with the initial status; an existing row (any status, including blocked) is left
// untouched, so a race between two first requests or with an admin decision never rewrites a decision.
// `created` is true only for the request that actually inserted the row (RETURNING is empty on conflict).
export async function firstSeen(userId: string, email: string, status: MemberStatus, ref: string | null): Promise<{ member: Member; created: boolean }> {
  const inserted = (await getSql().query(
    "INSERT INTO members (user_id, email, status, ref) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING RETURNING user_id",
    [userId, email, status, ref],
  )) as { user_id: string }[];
  const row = await getMember(userId);
  if (!row) throw new Error("members: row missing after insert");
  return { member: row, created: inserted.length > 0 };
}

export async function setMemberStatus(userId: string, status: MemberStatus, decidedBy: string): Promise<Member | null> {
  const rows = (await getSql().query(
    "UPDATE members SET status = $2, decided_at = now(), decided_by = $3 WHERE user_id = $1 RETURNING user_id, email, status, ref, created_at, decided_at, decided_by, welcomed_at",
    [userId, status, decidedBy],
  )) as Raw[];
  return rows[0] ? toMember(rows[0]) : null;
}

export async function markWelcomed(userId: string): Promise<void> {
  await getSql().query("UPDATE members SET welcomed_at = now() WHERE user_id = $1", [userId]);
}

export async function removeMember(userId: string): Promise<boolean> {
  const rows = (await getSql().query("DELETE FROM members WHERE user_id = $1 RETURNING user_id", [userId])) as { user_id: string }[];
  return rows.length > 0;
}

// Members joined with a summary of app_state. Only people who came through the door (a members row) are listed:
// invite-list and QA accounts with state but no row stayed out after the owner found the list full of entries that
// were not people to let in or turn away (2026-11-03).
export async function listMembers(): Promise<MemberRow[]> {
  const rows = (await getSql().query(
    `SELECT
       COALESCE(m.user_id, a.user_id) AS user_id,
       COALESCE(m.email, '') AS email,
       COALESCE(m.status, 'approved') AS status,
       m.ref,
       COALESCE(m.created_at, a.updated_at) AS created_at,
       m.decided_at,
       m.decided_by,
       m.welcomed_at,
       COALESCE((a.state -> 'profile' ->> 'onboarded')::boolean, false) AS onboarded,
       COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(a.state -> 'people') = 'array' THEN a.state -> 'people' ELSE '[]'::jsonb END), 0) AS people,
       (a.state ? 'plan' AND jsonb_typeof(a.state -> 'plan') = 'object') AS has_plan,
       a.updated_at AS last_seen
     FROM members m
     LEFT JOIN app_state a ON a.user_id = m.user_id
     ORDER BY m.created_at DESC`,
  )) as (Raw & { onboarded: boolean; people: number; has_plan: boolean | null; last_seen: string | Date | null })[];
  return rows.map((r) => ({ ...toMember(r), onboarded: r.onboarded === true, people: Number(r.people) || 0, hasPlan: r.has_plan === true, lastSeen: iso(r.last_seen) }));
}
