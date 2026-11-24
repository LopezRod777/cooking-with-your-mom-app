// Crea las tablas en Neon. Uso: node scripts/db/migrate.mjs
// Lee DATABASE_URL del entorno o de .env.local. Nunca imprime su valor.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m);
  if (!match) return undefined;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const url = readDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL no está definida (ni en el entorno ni en .env.local)");
  process.exit(1);
}

const sql = neon(url);

try {
  await sql`CREATE TABLE IF NOT EXISTS app_state (
    user_id text PRIMARY KEY,
    revision integer NOT NULL DEFAULT 0,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  const rows = await sql`SELECT count(*)::int AS n FROM app_state`;
  console.log(`ok app_state rows=${rows[0].n}`);
  // Waitlist: one row per signed-in account that is not on the invite list. Status decided by an admin.
  await sql`CREATE TABLE IF NOT EXISTS members (
    user_id text PRIMARY KEY,
    email text NOT NULL,
    status text NOT NULL CHECK (status IN ('waiting', 'approved', 'blocked')),
    ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    decided_by text,
    note text
  )`;
  await sql`CREATE INDEX IF NOT EXISTS members_status_created_idx ON members (status, created_at)`;
  await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS welcomed_at timestamptz`;
  const membersOk = await sql`SELECT
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'members') AS t,
    (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'members_status_created_idx') AS i,
    (SELECT count(*)::int FROM members) AS n`;
  if (membersOk[0].t !== 1 || membersOk[0].i !== 1) throw new Error("members table or index missing after migration");
  console.log(`ok members rows=${membersOk[0].n}`);

  // Health data a person shares (export upload today, device OAuth later). Kept out of app_state on purpose: only
  // three numbers a day, 90 days, deleted on request. Device tokens, when they come, go in their own table.
  await sql`CREATE TABLE IF NOT EXISTS wellness_daily (
    user_id text NOT NULL,
    day date NOT NULL,
    weight_kg numeric(5,1),
    sleep_h numeric(4,1),
    resting_hr smallint,
    source text NOT NULL DEFAULT 'upload',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS devices (
    user_id text PRIMARY KEY,
    brand text NOT NULL,
    status text NOT NULL DEFAULT 'chosen' CHECK (status IN ('chosen', 'connected')),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  const wellnessOk = await sql`SELECT
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wellness_daily') AS w,
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'devices') AS d`;
  if (wellnessOk[0].w !== 1 || wellnessOk[0].d !== 1) throw new Error("wellness tables missing after migration");
  console.log("ok wellness_daily + devices");

  // Community: text posts and comments, hearts, reports, a chosen table name per person, moderation budget.
  // Admission does not depend on `members` (invited and admin accounts have no row there).
  await sql`CREATE TABLE IF NOT EXISTS community_members (
    user_id text PRIMARY KEY,
    public_id char(10) NOT NULL UNIQUE,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'muted', 'banned')),
    abusive_reports int NOT NULL DEFAULT 0,
    joined_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS community_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    text text NOT NULL,
    state text NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'review', 'hidden', 'deleted')),
    mod_reason text,
    pinned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    hidden_at timestamptz,
    hidden_by text
  )`;
  await sql`CREATE INDEX IF NOT EXISTS community_posts_feed_idx ON community_posts (pinned DESC, created_at DESC) WHERE state = 'visible'`;
  await sql`CREATE INDEX IF NOT EXISTS community_posts_user_day_idx ON community_posts (user_id, created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS community_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    text text NOT NULL,
    state text NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'review', 'hidden', 'deleted')),
    mod_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS community_comments_post_idx ON community_comments (post_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS community_comments_user_day_idx ON community_comments (user_id, created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS community_hearts (
    post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS community_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_kind text NOT NULL CHECK (target_kind IN ('post', 'comment')),
    target_id uuid NOT NULL,
    reporter_id text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    outcome text CHECK (outcome IN ('upheld', 'dismissed', 'abusive')),
    UNIQUE (target_kind, target_id, reporter_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS community_reports_open_idx ON community_reports (created_at DESC) WHERE resolved_at IS NULL`;
  await sql`CREATE TABLE IF NOT EXISTS moderation_budget (
    day date PRIMARY KEY,
    used int NOT NULL DEFAULT 0
  )`;
  const communityOk = await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
    AND table_name IN ('community_members', 'community_posts', 'community_comments', 'community_hearts', 'community_reports', 'moderation_budget')`;
  if (communityOk[0].n !== 6) throw new Error("community tables missing after migration");
  console.log("ok community tables");

  // Fotos y recetas en la mesa: fotos privadas con cupo de intentos por persona, y recetas compartidas como copia completa.
  await sql`CREATE TABLE IF NOT EXISTS community_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    key text NOT NULL DEFAULT '',
    w int NOT NULL DEFAULT 0,
    h int NOT NULL DEFAULT 0,
    state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged', 'claimed', 'blocked', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS community_photos_user_day_idx ON community_photos (user_id, created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS community_recipes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id text NOT NULL,
    post_id uuid,
    recipe jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS photo_id uuid`;
  await sql`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS recipe_id uuid`;
  const photosOk = await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
    AND table_name IN ('community_photos', 'community_recipes')`;
  if (photosOk[0].n !== 2) throw new Error("community photos or recipes tables missing after migration");
  console.log("ok community photos + recipes");

  // Fotos por paso: contador atómico por persona y día (cuenta intentos; tope STEP_IMAGES_PER_DAY en el código).
  await sql`CREATE TABLE IF NOT EXISTS step_image_quota (
    user_id text NOT NULL,
    day date NOT NULL,
    n int NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`;
  console.log("ok step image quota");

  // Tope diario de IA por persona (src/lib/ai/dailyQuota.ts): un contador por usuario, cubeta y día UTC.
  await sql`CREATE TABLE IF NOT EXISTS ai_daily_quota (
    user_id text NOT NULL,
    bucket text NOT NULL,
    day date NOT NULL,
    n int NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, bucket, day)
  )`;
  console.log("ok ai daily quota");

  await sql`CREATE TABLE IF NOT EXISTS geo_cache (
    key text PRIMARY KEY,
    status text NOT NULL,
    owner text,
    lat double precision,
    lng double precision,
    label text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS places_cache (
    key text PRIMARY KEY,
    status text NOT NULL,
    owner text,
    json jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rate_gate (
    name text PRIMARY KEY,
    next_at timestamptz,
    lease_until timestamptz,
    owner text
  )`;
  await sql`INSERT INTO rate_gate (name) VALUES ('nominatim'), ('overpass') ON CONFLICT DO NOTHING`;
  // ZIP polygons for "Use my location" (Census TIGER 2020 ZCTA, coverage-simplified). Filled by scripts/data/load-zcta.sh;
  // empty table = the route falls back to the Census service.
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  await sql`CREATE TABLE IF NOT EXISTS zcta (
    zip char(5) PRIMARY KEY,
    geom geometry(MultiPolygon, 4326) NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS zcta_geom_gix ON zcta USING GIST (geom)`;
  await sql`CREATE TABLE IF NOT EXISTS pairings (
    user_id text NOT NULL,
    recipe_id text NOT NULL,
    json jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, recipe_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pairings_log (
    user_id text NOT NULL,
    day date NOT NULL,
    n int NOT NULL,
    PRIMARY KEY (user_id, day)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS bottle_scans (
    user_id text NOT NULL,
    day date NOT NULL,
    n int NOT NULL,
    PRIMARY KEY (user_id, day)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pairing_inflight (
    user_id text PRIMARY KEY,
    owner text NOT NULL,
    lease_until timestamptz NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pairing_unlocks (
    user_id text PRIMARY KEY,
    session_id text NOT NULL,
    nonce text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS kroger_calls (
    day date PRIMARY KEY,
    n int NOT NULL
  )`;
  const gate = await sql`SELECT count(*)::int AS n FROM rate_gate`;
  const geo = await sql`SELECT count(*)::int AS n FROM geo_cache`;
  const places = await sql`SELECT count(*)::int AS n FROM places_cache`;
  console.log(`ok geo_cache rows=${geo[0].n} places_cache rows=${places[0].n} rate_gate rows=${gate[0].n}`);
} catch (err) {
  console.error(`migración falló: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
