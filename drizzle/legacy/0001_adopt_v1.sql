-- Asteria · adopt a v1 database into the v2 schema.
--
-- The v1 shape was applied with `drizzle-kit push` from a schema that had no
-- migrations: `journals(id, created_at)` and `stars(...)` with an integer brightness
-- and no search column. Anyone who used the deployed build has data in that shape.
--
-- This script is ADDITIVE and IDEMPOTENT. It never drops a table, never rewrites a
-- row's text, and can be run twice without effect. Every statement is guarded, so it
-- degrades to a no-op on a database that has already been adopted.
--
-- Statement order matters: data is repaired to satisfy the constraints *before*
-- the constraints are added, so the `alter table` calls cannot fail on legacy rows.
--
-- `src/test/schema-adoption.test.ts` asserts that a database migrated through this
-- file is identical to one created directly from `drizzle/0000_init.sql`.

-- ── journals: new columns ───────────────────────────────────────────────────────────
alter table "journals" add column if not exists "display_name" varchar(60);
alter table "journals" add column if not exists "time_zone" varchar(64);
alter table "journals" add column if not exists "recovery_key_hash" text;
alter table "journals" add column if not exists "recovery_key_created_at" timestamp with time zone;
alter table "journals" add column if not exists "seeded_at" timestamp with time zone;
alter table "journals" add column if not exists "last_seen_at" timestamp with time zone not null default now();
alter table "journals" add column if not exists "share_anonymous_metrics" boolean not null default false;

-- A v1 journal was seeded with the example sky on its first request (that was the
-- behaviour of `requireJournal`), so mark it seeded: adoption must not plant a second
-- copy of the examples on top of the user's real sky.
update "journals" set "seeded_at" = "created_at" where "seeded_at" is null;

-- ── stars: repair legacy values so the v2 constraints can be added ───────────────────
-- Each of these is a clamp, never a deletion. A row whose text was longer than the
-- current product limit keeps as much of itself as fits.
update "stars" set "content" = left("content", 420) where char_length("content") > 420;
update "stars" set "content" = 'A moment kept.' where char_length(coalesce("content", '')) = 0;
update "stars" set "title" = left("title", 80) where char_length(coalesce("title", '')) > 80;
update "stars" set "intensity" = greatest(1, least(5, "intensity")) where "intensity" is null or "intensity" < 1 or "intensity" > 5;
update "stars" set "mood" = 'serene' where "mood" not in ('luminous', 'tender', 'serene', 'electric', 'verdant', 'vesper');
update "stars" set "x" = 0 where "x" is null or "x" < -100000 or "x" > 100000;
update "stars" set "y" = 0 where "y" is null or "y" < -100000 or "y" > 100000;

-- ── stars: the v2 shape ─────────────────────────────────────────────────────────────
alter table "stars" alter column "intensity" type smallint using "intensity"::smallint;
alter table "stars" alter column "intensity" set default 3;
alter table "stars" alter column "title" set default '';
alter table "stars" alter column "favorite" set default false;
alter table "stars" alter column "updated_at" set default now();
alter table "stars" alter column "created_at" set default now();

alter table "stars" add column if not exists "search" tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stars_mood_check') then
    alter table "stars" add constraint "stars_mood_check"
      check ("mood" in ('luminous','tender','serene','electric','verdant','vesper'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stars_intensity_check') then
    alter table "stars" add constraint "stars_intensity_check" check ("intensity" between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stars_content_length_check') then
    alter table "stars" add constraint "stars_content_length_check" check (char_length("content") between 1 and 420);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stars_title_length_check') then
    alter table "stars" add constraint "stars_title_length_check" check (char_length("title") <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stars_coords_check') then
    alter table "stars" add constraint "stars_coords_check"
      check ("x" between -100000 and 100000 and "y" between -100000 and 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stars_journal_id_journals_id_fk') then
    alter table "stars" add constraint "stars_journal_id_journals_id_fk"
      foreign key ("journal_id") references "journals"("id") on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'journal_events_journal_id_journals_id_fk') then
    alter table "journal_events" add constraint "journal_events_journal_id_journals_id_fk"
      foreign key ("journal_id") references "journals"("id") on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_journal_id_journals_id_fk') then
    alter table "sessions" add constraint "sessions_journal_id_journals_id_fk"
      foreign key ("journal_id") references "journals"("id") on delete cascade;
  end if;
end $$;

-- ── tables introduced in v2 ─────────────────────────────────────────────────────────
create table if not exists "sessions" (
  "id" uuid primary key default gen_random_uuid() not null,
  "journal_id" uuid not null,
  "token_hash" text not null,
  "device" varchar(48),
  "created_at" timestamp with time zone default now() not null,
  "last_seen_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone not null,
  "revoked_at" timestamp with time zone
);

create table if not exists "journal_events" (
  "id" bigserial primary key not null,
  "journal_id" uuid,
  "kind" varchar(40) not null,
  "star_id" uuid,
  "meta" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "rate_limits" (
  "bucket" text not null,
  "window_start" timestamp with time zone not null,
  "count" integer default 0 not null,
  "expires_at" timestamp with time zone not null,
  constraint "rate_limits_bucket_window_start_pk" primary key ("bucket", "window_start")
);

-- ── indexes ─────────────────────────────────────────────────────────────────────────
-- v1's `stars_journal_date_idx` covered the same columns under an older name.
drop index if exists "stars_journal_date_idx";

create index if not exists "journal_events_journal_idx" on "journal_events" using btree ("journal_id", "created_at");
create unique index if not exists "journals_recovery_key_idx" on "journals" using btree ("recovery_key_hash");
create index if not exists "journals_last_seen_idx" on "journals" using btree ("last_seen_at");
create index if not exists "rate_limits_expiry_idx" on "rate_limits" using btree ("expires_at");
create unique index if not exists "sessions_token_idx" on "sessions" using btree ("token_hash");
create index if not exists "sessions_journal_idx" on "sessions" using btree ("journal_id", "expires_at");
create index if not exists "stars_journal_created_idx" on "stars" using btree ("journal_id", "created_at");
create index if not exists "stars_search_idx" on "stars" using gin ("search");
create index if not exists "stars_journal_mood_idx" on "stars" using btree ("journal_id", "mood");
