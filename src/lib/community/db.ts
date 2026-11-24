import { getSql } from "../db";

// The table: text posts and comments between members, with Mama as host. Everything public here passed
// moderate.ts first. No Clerk ids leave the server: people are shown by public_id and the name they chose.
export const POST_MAX = 500;
export const COMMENT_MAX = 300;
export const NAME_MAX = 24;
export const POSTS_PER_DAY = 10;
export const COMMENTS_PER_DAY = 60;
export const REPORTS_PER_DAY = 10;
export const WRITE_GAP_S = 20;
export const MAMA_ID = "mama";
export const REPORTS_TO_HIDE = 3;
export const ABUSIVE_REPORTS_TO_MUTE = 3;

export type MemberStatus = "ok" | "muted" | "banned";
export type Me = { publicId: string; name: string; status: MemberStatus } | null;
export type FeedPost = {
  id: string;
  author: { publicId: string; name: string };
  text: string;
  pinned: boolean;
  mine: boolean;
  hearts: number;
  hearted: boolean;
  comments: number;
  state: "visible" | "review";
  createdAt: string;
};
export type FeedComment = { id: string; author: { publicId: string; name: string }; text: string; mine: boolean; createdAt: string; state: "visible" | "review" };

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function publicId(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function notMigrated(err: unknown): boolean {
  return err instanceof Error && /relation .* does not exist/i.test(err.message);
}

export async function me(userId: string): Promise<Me | "not_migrated"> {
  try {
    const rows = (await getSql().query(`SELECT public_id, display_name, status FROM community_members WHERE user_id = $1`, [userId])) as { public_id: string; display_name: string; status: MemberStatus }[];
    return rows[0] ? { publicId: rows[0].public_id, name: rows[0].display_name, status: rows[0].status } : null;
  } catch (err) {
    if (notMigrated(err)) return "not_migrated";
    throw err;
  }
}

// Sets (or changes) the name shown at the table. The caller moderated it. Retries the public id on collision.
export async function setName(userId: string, name: string): Promise<Me> {
  const sql = getSql();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = (await sql.query(
        `INSERT INTO community_members (user_id, public_id, display_name) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
         RETURNING public_id, display_name, status`,
        [userId, publicId(), name],
      )) as { public_id: string; display_name: string; status: MemberStatus }[];
      return { publicId: rows[0].public_id, name: rows[0].display_name, status: rows[0].status };
    } catch (err) {
      if (!(err instanceof Error && /community_members_public_id_key/.test(err.message))) throw err;
    }
  }
  throw new Error("community: could not allot a public id");
}

// One classifier call from today's budget; false when it is spent.
export async function spendModeration(limit: number): Promise<boolean> {
  const rows = (await getSql().query(
    `INSERT INTO moderation_budget (day, used) VALUES (current_date, 1)
     ON CONFLICT (day) DO UPDATE SET used = moderation_budget.used + 1 WHERE moderation_budget.used < $1
     RETURNING used`,
    [limit],
  )) as { used: number }[];
  return rows.length > 0;
}

// Atomic daily cap + spacing: the insert only happens when both hold. null = over a limit.
export async function insertPost(
  userId: string,
  text: string,
  state: "visible" | "review",
  modReason: string | null,
  extra: { photoId?: string | null; recipeId?: string | null } = {},
): Promise<string | null> {
  const rows = (await getSql().query(
    `INSERT INTO community_posts (user_id, text, state, mod_reason, photo_id, recipe_id)
     SELECT $1, $2, $3, $4, $7::uuid, $8::uuid
     WHERE (SELECT count(*) FROM community_posts WHERE user_id = $1 AND created_at > now() - interval '1 day') < $5
       AND NOT EXISTS (SELECT 1 FROM community_posts WHERE user_id = $1 AND created_at > now() - ($6 || ' seconds')::interval)
       AND NOT EXISTS (SELECT 1 FROM community_comments WHERE user_id = $1 AND created_at > now() - ($6 || ' seconds')::interval)
     RETURNING id`,
    [userId, text, state, modReason, POSTS_PER_DAY, String(WRITE_GAP_S), extra.photoId ?? null, extra.recipeId ?? null],
  )) as { id: string }[];
  return rows[0]?.id ?? null;
}

// ----- photos -----
// Upload budget and lifecycle. A row is 'staged' from the moment the upload is reserved until a post claims it
// (once), or it expires. Every attempt counts against the daily cap, whatever its outcome.
export const PHOTO_ATTEMPTS_PER_DAY = 15;
export type PhotoState = "staged" | "claimed" | "blocked" | "deleted";

// Atomic daily cap: the insert only happens under the cap. null = over the limit.
export async function reservePhotoAttempt(userId: string): Promise<string | null> {
  const rows = (await getSql().query(
    `INSERT INTO community_photos (user_id)
     SELECT $1
     WHERE (SELECT count(*) FROM community_photos WHERE user_id = $1 AND created_at > now() - interval '1 day') < $2
     RETURNING id`,
    [userId, PHOTO_ATTEMPTS_PER_DAY],
  )) as { id: string }[];
  return rows[0]?.id ?? null;
}

export async function stagePhoto(photoId: string, userId: string, key: string, w: number, h: number): Promise<void> {
  await getSql().query(`UPDATE community_photos SET key = $3, w = $4, h = $5 WHERE id = $1 AND user_id = $2 AND state = 'staged'`, [photoId, userId, key, w, h]);
}

export async function markPhotoBlocked(photoId: string, userId: string): Promise<void> {
  await getSql().query(`UPDATE community_photos SET state = 'blocked', key = '' WHERE id = $1 AND user_id = $2 AND state = 'staged'`, [photoId, userId]);
}

// staged → claimed, once. A post takes the photo through this; a second claim gets null.
export async function claimPhoto(photoId: string, userId: string): Promise<{ key: string; w: number; h: number } | null> {
  const rows = (await getSql().query(
    `UPDATE community_photos SET state = 'claimed' WHERE id = $1 AND user_id = $2 AND state = 'staged' AND key <> '' RETURNING key, w, h`,
    [photoId, userId],
  )) as { key: string; w: number; h: number }[];
  return rows[0] ?? null;
}

// Staged photos older than the window go to 'deleted'; returns the blob keys the caller must delete.
export async function expireStaged(userId: string, olderThanMinutes = 60): Promise<string[]> {
  const rows = (await getSql().query(
    `UPDATE community_photos SET state = 'deleted'
     WHERE user_id = $1 AND state = 'staged' AND created_at < now() - ($2 || ' minutes')::interval
     RETURNING key`,
    [userId, String(olderThanMinutes)],
  )) as { key: string }[];
  return rows.map((r) => r.key).filter((k) => k !== "");
}

// Who may see a photo's bytes. A photo nobody has posted yet is visible only to its uploader (preview).
// Otherwise it follows the post's state: visible → any admitted member; review → author or admin; hidden → admin.
export async function photoForViewer(photoId: string, viewerId: string, isAdmin: boolean): Promise<{ key: string } | null> {
  const rows = (await getSql().query(
    `SELECT p.key
     FROM community_photos p
     LEFT JOIN community_posts cp ON cp.photo_id = p.id
     WHERE p.id = $1
       AND NOT EXISTS (SELECT 1 FROM community_members b WHERE b.user_id = $2 AND b.status = 'banned')
       AND p.key <> ''
       AND (
         -- Staged (not yet posted) or claimed-but-unposted: the uploader's own preview only.
         (cp.id IS NULL AND p.state IN ('staged', 'claimed') AND p.user_id = $2)
         OR (p.state = 'claimed' AND (
           cp.state = 'visible'
           OR (cp.state = 'review' AND (cp.user_id = $2 OR $3::boolean))
           OR (cp.state = 'hidden' AND $3::boolean)
         ))
       )
     LIMIT 1`,
    [photoId, viewerId, isAdmin],
  )) as { key: string }[];
  return rows[0] ? { key: rows[0].key } : null;
}

// ----- shared recipes -----
// Copy of the recipe as the server read it from the author's own state. The route validates it before it gets here.
export async function insertSharedRecipe(authorId: string, recipe: unknown): Promise<string> {
  const rows = (await getSql().query(`INSERT INTO community_recipes (author_id, recipe) VALUES ($1, $2::jsonb) RETURNING id`, [authorId, JSON.stringify(recipe)])) as {
    id: string;
  }[];
  return rows[0].id;
}

// Hidden and deleted posts hide the recipe; a review post shows it to its author only.
export async function sharedRecipe(
  id: string,
  viewerId: string,
): Promise<{ recipe: unknown; author: { publicId: string; name: string }; postState: "visible" | "review" } | null> {
  const rows = (await getSql().query(
    `SELECT r.recipe, r.author_id, m.public_id, m.display_name, cp.state
     FROM community_recipes r
     JOIN community_members m ON m.user_id = r.author_id
     LEFT JOIN community_posts cp ON cp.recipe_id = r.id
     WHERE r.id = $1`,
    [id],
  )) as { recipe: unknown; author_id: string; public_id: string; display_name: string; state: "visible" | "review" | "hidden" | "deleted" | null }[];
  if (rows.length === 0) return null;
  const blocked = rows.some((r) => r.state === "hidden" || r.state === "deleted" || (r.state === "review" && r.author_id !== viewerId));
  if (blocked) return null;
  const row = rows[0];
  return {
    recipe: row.recipe,
    author: { publicId: row.public_id, name: row.display_name },
    postState: row.state === "review" ? "review" : "visible",
  };
}

export async function insertComment(userId: string, postId: string, text: string, state: "visible" | "review", modReason: string | null): Promise<string | null> {
  const rows = (await getSql().query(
    `INSERT INTO community_comments (post_id, user_id, text, state, mod_reason)
     SELECT $2, $1, $3, $4, $5
     WHERE EXISTS (SELECT 1 FROM community_posts WHERE id = $2 AND state = 'visible')
       AND (SELECT count(*) FROM community_comments WHERE user_id = $1 AND created_at > now() - interval '1 day') < $6
       AND NOT EXISTS (SELECT 1 FROM community_comments WHERE user_id = $1 AND created_at > now() - ($7 || ' seconds')::interval)
     RETURNING id`,
    [userId, postId, text, state, modReason, COMMENTS_PER_DAY, String(WRITE_GAP_S)],
  )) as { id: string }[];
  return rows[0]?.id ?? null;
}

// Visible posts, newest first, pinned on top; the viewer's own posts under review show too (marked).
export async function feed(viewerId: string, limit = 40, before: string | null = null): Promise<FeedPost[]> {
  const rows = (await getSql().query(
    `SELECT p.id, p.text, p.pinned, p.state, p.created_at, p.user_id = $1 AS mine,
            m.public_id, m.display_name,
            (SELECT count(*)::int FROM community_hearts h WHERE h.post_id = p.id) AS hearts,
            EXISTS (SELECT 1 FROM community_hearts h WHERE h.post_id = p.id AND h.user_id = $1) AS hearted,
            (SELECT count(*)::int FROM community_comments c WHERE c.post_id = p.id AND c.state = 'visible') AS comments
     FROM community_posts p JOIN community_members m ON m.user_id = p.user_id
     WHERE (p.state = 'visible' OR (p.state = 'review' AND p.user_id = $1))
       AND ($3::timestamptz IS NULL OR p.created_at < $3)
     ORDER BY p.pinned DESC, p.created_at DESC LIMIT $2`,
    [viewerId, limit, before],
  )) as { id: string; text: string; pinned: boolean; state: "visible" | "review"; created_at: string; mine: boolean; public_id: string; display_name: string; hearts: number; hearted: boolean; comments: number }[];
  return rows.map((r) => ({
    id: r.id,
    author: { publicId: r.public_id, name: r.display_name },
    text: r.text,
    pinned: r.pinned,
    mine: r.mine,
    hearts: r.hearts,
    hearted: r.hearted,
    comments: r.comments,
    state: r.state,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

// Chat view: posts and comments in one time line, oldest first (the last `limit`). Comments carry a snippet of
// the message they answer. Mama's pinned note is not in here; `pinned()` serves it for the bar at the top.
export type ChatItem = {
  kind: "post" | "comment";
  id: string;
  postId: string;
  author: { publicId: string; name: string };
  text: string;
  mine: boolean;
  state: "visible" | "review";
  createdAt: string;
  hearts: number;
  hearted: boolean;
  replyTo: { name: string; text: string } | null;
  photoId: string | null;
  photoW: number | null;
  photoH: number | null;
  recipe: { id: string; title: string; minutes: number | null; imageUrl: string | null } | null;
};

export async function timeline(viewerId: string, limit = 150): Promise<ChatItem[]> {
  const rows = (await getSql().query(
    `SELECT * FROM (
       SELECT 'post' AS kind, p.id, p.id AS post_id, p.text, p.state, p.created_at, p.user_id = $1 AS mine,
              m.public_id, m.display_name,
              (SELECT count(*)::int FROM community_hearts h WHERE h.post_id = p.id) AS hearts,
              EXISTS (SELECT 1 FROM community_hearts h WHERE h.post_id = p.id AND h.user_id = $1) AS hearted,
              NULL::text AS reply_name, NULL::text AS reply_text,
              p.photo_id, ph.w AS photo_w, ph.h AS photo_h,
              rc.id AS recipe_id, rc.recipe->>'title' AS recipe_title,
              CASE WHEN rc.recipe->>'minutes' ~ '^[0-9]+$' THEN (rc.recipe->>'minutes')::int END AS recipe_minutes,
              rc.recipe->>'imageUrl' AS recipe_image
       FROM community_posts p
       JOIN community_members m ON m.user_id = p.user_id
       LEFT JOIN community_photos ph ON ph.id = p.photo_id
       LEFT JOIN community_recipes rc ON rc.id = p.recipe_id
       WHERE NOT p.pinned AND (p.state = 'visible' OR (p.state = 'review' AND p.user_id = $1))
       UNION ALL
       SELECT 'comment', c.id, c.post_id, c.text, c.state, c.created_at, c.user_id = $1,
              m.public_id, m.display_name, 0, false, pm.display_name, left(p.text, 80),
              NULL::uuid, NULL::int, NULL::int, NULL::uuid, NULL::text, NULL::int, NULL::text
       FROM community_comments c
       JOIN community_members m ON m.user_id = c.user_id
       JOIN community_posts p ON p.id = c.post_id
       JOIN community_members pm ON pm.user_id = p.user_id
       WHERE (c.state = 'visible' OR (c.state = 'review' AND c.user_id = $1)) AND (p.state = 'visible' OR (p.state = 'review' AND p.user_id = $1))
     ) t ORDER BY created_at DESC LIMIT $2`,
    [viewerId, limit],
  )) as {
    kind: "post" | "comment";
    id: string;
    post_id: string;
    text: string;
    state: "visible" | "review";
    created_at: string;
    mine: boolean;
    public_id: string;
    display_name: string;
    hearts: number;
    hearted: boolean;
    reply_name: string | null;
    reply_text: string | null;
    photo_id: string | null;
    photo_w: number | null;
    photo_h: number | null;
    recipe_id: string | null;
    recipe_title: string | null;
    recipe_minutes: number | null;
    recipe_image: string | null;
  }[];
  return rows
    .reverse()
    .map((r) => ({
      kind: r.kind,
      id: r.id,
      postId: r.post_id,
      author: { publicId: r.public_id, name: r.display_name },
      text: r.text,
      mine: r.mine,
      state: r.state,
      createdAt: new Date(r.created_at).toISOString(),
      hearts: r.hearts,
      hearted: r.hearted,
      replyTo: r.reply_name ? { name: r.reply_name, text: r.reply_text ?? "" } : null,
      photoId: r.photo_id,
      photoW: r.photo_w,
      photoH: r.photo_h,
      recipe: r.recipe_id ? { id: r.recipe_id, title: r.recipe_title ?? "", minutes: r.recipe_minutes, imageUrl: r.recipe_image } : null,
    }));
}

// Messages from other people since `since` (ISO), for the dot on the header bubble. Null = the last 7 days.
export async function unreadCount(viewerId: string, since: string | null): Promise<number> {
  const rows = (await getSql().query(
    `SELECT (
       (SELECT count(*) FROM community_posts p WHERE p.state = 'visible' AND NOT p.pinned AND p.user_id <> $1 AND p.created_at > COALESCE($2::timestamptz, now() - interval '7 days'))
     + (SELECT count(*) FROM community_comments c WHERE c.state = 'visible' AND c.user_id <> $1 AND c.created_at > COALESCE($2::timestamptz, now() - interval '7 days'))
     )::int AS n`,
    [viewerId, since],
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function pinned(): Promise<{ id: string; text: string } | null> {
  const rows = (await getSql().query(`SELECT id, text FROM community_posts WHERE user_id = $1 AND pinned AND state = 'visible' LIMIT 1`, [MAMA_ID])) as { id: string; text: string }[];
  return rows[0] ?? null;
}

export async function comments(viewerId: string, postId: string): Promise<FeedComment[]> {
  const rows = (await getSql().query(
    `SELECT c.id, c.text, c.state, c.created_at, c.user_id = $1 AS mine, m.public_id, m.display_name
     FROM community_comments c JOIN community_members m ON m.user_id = c.user_id
     JOIN community_posts p ON p.id = c.post_id
     WHERE c.post_id = $2 AND (c.state = 'visible' OR (c.state = 'review' AND c.user_id = $1))
       AND (p.state = 'visible' OR (p.state = 'review' AND p.user_id = $1))
     ORDER BY c.created_at ASC LIMIT 200`,
    [viewerId, postId],
  )) as { id: string; text: string; state: "visible" | "review"; created_at: string; mine: boolean; public_id: string; display_name: string }[];
  return rows.map((r) => ({ id: r.id, author: { publicId: r.public_id, name: r.display_name }, text: r.text, mine: r.mine, createdAt: new Date(r.created_at).toISOString(), state: r.state }));
}

export async function toggleHeart(userId: string, postId: string): Promise<{ hearted: boolean; hearts: number } | null> {
  const sql = getSql();
  const exists = (await sql.query(`SELECT 1 FROM community_posts WHERE id = $1 AND state = 'visible'`, [postId])) as unknown[];
  if (exists.length === 0) return null;
  const del = (await sql.query(`DELETE FROM community_hearts WHERE post_id = $1 AND user_id = $2 RETURNING 1`, [postId, userId])) as unknown[];
  if (del.length === 0) await sql.query(`INSERT INTO community_hearts (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [postId, userId]);
  const n = (await sql.query(`SELECT count(*)::int AS n FROM community_hearts WHERE post_id = $1`, [postId])) as { n: number }[];
  return { hearted: del.length === 0, hearts: n[0].n };
}

// Authors delete their own; the row stays as 'deleted' for the report trail and is never shown again.
// A deleted post also deletes its photo; the caller removes the returned blob keys.
export async function deleteOwn(userId: string, kind: "post" | "comment", id: string): Promise<{ ok: boolean; keys: string[] }> {
  const sql = getSql();
  if (kind === "comment") {
    const rows = (await sql.query(`UPDATE community_comments SET state = 'deleted' WHERE id = $1 AND user_id = $2 AND state <> 'deleted' RETURNING 1`, [id, userId])) as unknown[];
    return { ok: rows.length > 0, keys: [] };
  }
  const posts = (await sql.query(`UPDATE community_posts SET state = 'deleted' WHERE id = $1 AND user_id = $2 AND state <> 'deleted' RETURNING photo_id`, [id, userId])) as {
    photo_id: string | null;
  }[];
  if (posts.length === 0) return { ok: false, keys: [] };
  if (!posts[0].photo_id) return { ok: true, keys: [] };
  const photos = (await sql.query(`UPDATE community_photos SET state = 'deleted' WHERE id = $1 AND user_id = $2 AND state <> 'deleted' RETURNING key`, [posts[0].photo_id, userId])) as {
    key: string;
  }[];
  return { ok: true, keys: photos.map((p) => p.key).filter((k) => k !== "") };
}

export type ReportOutcome = "recorded" | "duplicate" | "own" | "missing" | "limit";
// Records one report; three from different people hide the target until the admin looks.
export async function report(reporterId: string, kind: "post" | "comment", id: string, reason: string): Promise<ReportOutcome> {
  const sql = getSql();
  const table = kind === "post" ? "community_posts" : "community_comments";
  const target = (await sql.query(`SELECT user_id FROM ${table} WHERE id = $1 AND state = 'visible'`, [id])) as { user_id: string }[];
  if (target.length === 0) return "missing";
  if (target[0].user_id === reporterId) return "own";
  const ins = (await sql.query(
    `INSERT INTO community_reports (target_kind, target_id, reporter_id, reason)
     SELECT $1, $2, $3, $4
     WHERE (SELECT count(*) FROM community_reports WHERE reporter_id = $3 AND created_at > now() - interval '1 day') < $5
     ON CONFLICT DO NOTHING RETURNING id`,
    [kind, id, reporterId, reason, REPORTS_PER_DAY],
  )) as unknown[];
  if (ins.length === 0) {
    const dup = (await sql.query(`SELECT 1 FROM community_reports WHERE target_kind = $1 AND target_id = $2 AND reporter_id = $3`, [kind, id, reporterId])) as unknown[];
    return dup.length ? "duplicate" : "limit";
  }
  const n = (await sql.query(`SELECT count(DISTINCT reporter_id)::int AS n FROM community_reports WHERE target_kind = $1 AND target_id = $2 AND resolved_at IS NULL`, [kind, id])) as { n: number }[];
  if (n[0].n >= REPORTS_TO_HIDE) {
    await sql.query(`UPDATE ${table} SET state = 'review', mod_reason = 'reported by ' || $2 || ' people' WHERE id = $1 AND state = 'visible'`, [id, String(n[0].n)]);
  }
  return "recorded";
}

// ----- admin -----
export type QueueItem = {
  kind: "post" | "comment";
  id: string;
  text: string;
  state: "visible" | "review" | "hidden" | "deleted";
  modReason: string | null;
  createdAt: string;
  author: { publicId: string; name: string; status: MemberStatus; userId: string };
  openReports: number;
  reasons: string[];
  photoId: string | null;
};

export async function queue(): Promise<QueueItem[]> {
  const rows = (await getSql().query(
    `WITH items AS (
       SELECT 'post' AS kind, id, user_id, text, state, mod_reason, created_at, photo_id FROM community_posts WHERE state IN ('review', 'hidden')
       UNION ALL
       SELECT 'comment', id, user_id, text, state, mod_reason, created_at, NULL::uuid FROM community_comments WHERE state IN ('review', 'hidden')
       UNION ALL
       SELECT r.target_kind, r.target_id, COALESCE(p.user_id, c.user_id), COALESCE(p.text, c.text), COALESCE(p.state, c.state), COALESCE(p.mod_reason, c.mod_reason), COALESCE(p.created_at, c.created_at), p.photo_id
       FROM community_reports r
       LEFT JOIN community_posts p ON r.target_kind = 'post' AND p.id = r.target_id
       LEFT JOIN community_comments c ON r.target_kind = 'comment' AND c.id = r.target_id
       WHERE r.resolved_at IS NULL AND COALESCE(p.state, c.state) = 'visible'
     )
     SELECT DISTINCT ON (i.kind, i.id) i.kind, i.id, i.text, i.state, i.mod_reason, i.created_at, i.user_id, i.photo_id,
            m.public_id, m.display_name, m.status,
            (SELECT count(*)::int FROM community_reports r WHERE r.target_kind = i.kind AND r.target_id = i.id AND r.resolved_at IS NULL) AS open_reports,
            (SELECT array_agg(r.reason) FROM community_reports r WHERE r.target_kind = i.kind AND r.target_id = i.id AND r.resolved_at IS NULL) AS reasons
     FROM items i JOIN community_members m ON m.user_id = i.user_id
     ORDER BY i.kind, i.id, i.created_at DESC`,
  )) as { kind: "post" | "comment"; id: string; text: string; state: QueueItem["state"]; mod_reason: string | null; created_at: string; user_id: string; photo_id: string | null; public_id: string; display_name: string; status: MemberStatus; open_reports: number; reasons: string[] | null }[];
  return rows
    .map((r) => ({
      kind: r.kind,
      id: r.id,
      text: r.text,
      state: r.state,
      modReason: r.mod_reason,
      createdAt: new Date(r.created_at).toISOString(),
      author: { publicId: r.public_id, name: r.display_name, status: r.status, userId: r.user_id },
      openReports: r.open_reports,
      reasons: r.reasons ?? [],
      photoId: r.photo_id ?? null,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export type AdminAction = "show" | "hide" | "mute" | "ban" | "restore_member";
// `keys` are the blob keys the caller must delete: only a ban removes photos here (hide keeps them 30 days).
export async function act(adminId: string, kind: "post" | "comment", id: string, action: AdminAction): Promise<{ ok: boolean; keys: string[] }> {
  const sql = getSql();
  const table = kind === "post" ? "community_posts" : "community_comments";
  if (action === "show") {
    const r = (await sql.query(`UPDATE ${table} SET state = 'visible', mod_reason = NULL WHERE id = $1 AND state IN ('review', 'hidden') RETURNING user_id`, [id])) as unknown[];
    // Reports on a post the admin restored were wrong: mark them, and count them against the reporters.
    await sql.query(
      `WITH r AS (UPDATE community_reports SET resolved_at = now(), outcome = 'abusive' WHERE target_kind = $1 AND target_id = $2 AND resolved_at IS NULL RETURNING reporter_id)
       UPDATE community_members m SET abusive_reports = m.abusive_reports + 1,
         status = CASE WHEN m.status = 'ok' AND m.abusive_reports + 1 >= $3 THEN 'muted' ELSE m.status END
       WHERE m.user_id IN (SELECT reporter_id FROM r)`,
      [kind, id, ABUSIVE_REPORTS_TO_MUTE],
    );
    return { ok: r.length > 0, keys: [] };
  }
  if (action === "hide") {
    const r = (await sql.query(`UPDATE ${table} SET state = 'hidden', hidden_at = now(), hidden_by = $2 WHERE id = $1 AND state <> 'deleted' RETURNING 1`, [id, adminId]).catch(async () => sql.query(`UPDATE ${table} SET state = 'hidden' WHERE id = $1 AND state <> 'deleted' RETURNING 1`, [id]))) as unknown[];
    await sql.query(`UPDATE community_reports SET resolved_at = now(), outcome = 'upheld' WHERE target_kind = $1 AND target_id = $2 AND resolved_at IS NULL`, [kind, id]);
    return { ok: r.length > 0, keys: [] };
  }
  const author = (await sql.query(`SELECT user_id FROM ${table} WHERE id = $1`, [id])) as { user_id: string }[];
  if (author.length === 0) return { ok: false, keys: [] };
  const status: MemberStatus = action === "mute" ? "muted" : action === "ban" ? "banned" : "ok";
  await sql.query(`UPDATE community_members SET status = $2, updated_at = now() WHERE user_id = $1`, [author[0].user_id, status]);
  if (action === "ban") {
    await sql.query(`UPDATE community_posts SET state = 'hidden' WHERE user_id = $1 AND state IN ('visible', 'review')`, [author[0].user_id]);
    await sql.query(`UPDATE community_comments SET state = 'hidden' WHERE user_id = $1 AND state IN ('visible', 'review')`, [author[0].user_id]);
    const photos = (await sql.query(`UPDATE community_photos SET state = 'deleted' WHERE user_id = $1 AND state = 'claimed' RETURNING key`, [author[0].user_id])) as { key: string }[];
    return { ok: true, keys: photos.map((p) => p.key).filter((k) => k !== "") };
  }
  return { ok: true, keys: [] };
}

// The recipe as the author has it in their own state (`plan` or favorites). Plain JSON; the route validates it.
export async function sharedRecipeForAuthor(authorId: string, recipeId: string): Promise<unknown | null> {
  const rows = (await getSql().query(`SELECT state FROM app_state WHERE user_id = $1`, [authorId])) as {
    state: { plan?: { recipes?: Record<string, unknown> }; favoriteRecipes?: Record<string, unknown> } | null;
  }[];
  const state = rows[0]?.state;
  return state?.plan?.recipes?.[recipeId] ?? state?.favoriteRecipes?.[recipeId] ?? null;
}

// Mama's pinned welcome: created once, by the server, under a reserved member row. Short: it is a note on the
// fridge, not a letter. The text is kept in step with WELCOME_TEXT on every read, so a copy change reaches prod.
export const WELCOME_TEXT =
  "Come sit, honey. Tell me how the week went, ask when something flops, and be kind to each other. I’m right here.";
export async function ensureWelcome(): Promise<void> {
  const sql = getSql();
  await sql.query(
    `INSERT INTO community_members (user_id, public_id, display_name) VALUES ($1, 'mamastable', 'Mama') ON CONFLICT (user_id) DO NOTHING`,
    [MAMA_ID],
  );
  const has = (await sql.query(`SELECT id, text FROM community_posts WHERE user_id = $1 AND pinned`, [MAMA_ID])) as { id: string; text: string }[];
  if (has.length === 0) {
    await sql.query(`INSERT INTO community_posts (user_id, text, state, pinned) VALUES ($1, $2, 'visible', true)`, [MAMA_ID, WELCOME_TEXT]);
  } else if (has[0].text !== WELCOME_TEXT) {
    await sql.query(`UPDATE community_posts SET text = $2 WHERE id = $1`, [has[0].id, WELCOME_TEXT]);
  }
}
