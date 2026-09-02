-- Migration 0035: DB-enforced reserved-hostname guard for app_listings (Codex #5).
--
-- Context: RESERVED_APP_IDS (src/lib/hotwireDomain.ts) was previously validated
-- only in the app-layer validateDropSubmission() called from the drops.ts POST
-- handler. Enforcement lived entirely in application code, so any alternate or
-- future write path to app_listings (a raced insert, an admin tool, a bulk
-- import) could still land a reserved id/hostname with nothing at the DB
-- boundary to stop it. The router resolves tenant hosts via
-- `WHERE hostname = ? OR id = ?`, so a reserved id or hostname landing in this
-- table is directly exploitable as a first-party-looking subdomain takeover
-- (e.g. claiming inbox.nates-software.com / chat.nates-software.com).
--
-- This migration makes the reserved-name rule a DATABASE invariant, not just
-- an application convention:
--   1. Backfill any existing NULL hostname to id (matches the original 0025
--      backfill intent; closes the gap where a listing with NULL hostname
--      relies solely on the router's `OR id = ?` fallback).
--   2. BEFORE INSERT / BEFORE UPDATE OF hostname, id triggers that RAISE(ABORT)
--      if the effective row's id or hostname matches a first-party reserved
--      name — regardless of which code path performs the write. The
--      reserved-name list here mirrors RESERVED_APP_IDS in
--      src/lib/hotwireDomain.ts; the two must be kept in sync if either
--      changes.
--
-- On hostname NOT NULL: migration 0026 already created a UNIQUE index on
-- app_listings(hostname) (idx_app_listings_hostname_unique). This migration
-- deliberately does NOT add a trigger-level "hostname IS NULL -> RAISE(ABORT)"
-- guard, because plain SQLite BEFORE INSERT triggers on a real table cannot
-- assign a computed default into NEW.hostname (that capability is limited to
-- INSTEAD OF triggers on views), so the only way to hard-block NULL at the DB
-- layer would be a full ALTER TABLE rebuild (drop/recreate app_listings with
-- hostname TEXT NOT NULL) — a high-risk operation on a table with many
-- inbound FKs, and unnecessary here since the actual exploitable gap is
-- RESERVED NAMES, not an incidental NULL. hostname non-null is instead
-- enforced going forward at the write boundary: functions/api/drops.ts now
-- always binds hostname = dropId on INSERT (see that file), and step 1 below
-- backfills any pre-existing NULLs. If a future write path needs a hard DB
-- NOT NULL guarantee, do the table-rebuild migration as its own dedicated,
-- carefully-tested change.
--
-- D1 migration gate: no CREATE TEMP TABLE, no deferrable FK constraints used.
-- Triggers + a plain backfill UPDATE are both well-supported D1/SQLite
-- operations (see migration 0030 for the precedent of BEFORE INSERT/UPDATE
-- RAISE(ABORT) guard triggers in this repo).

PRAGMA foreign_keys = ON;

-- 1. Close the NULL-hostname gap on any pre-existing rows.
UPDATE app_listings
SET hostname = id
WHERE hostname IS NULL;

-- 2. Reject reserved ids/hostnames at INSERT time, regardless of which code
--    path performs the write. (Intentionally does NOT reject NULL hostname —
--    see the module header on why that's out of scope for a trigger; a NULL
--    hostname is fully legal here and simply won't match a reserved word.)
CREATE TRIGGER IF NOT EXISTS app_listings_reserved_hostname_guard_insert
BEFORE INSERT ON app_listings
BEGIN
    SELECT RAISE(ABORT, 'reserved app id/hostname cannot be used for app_listings')
    WHERE lower(NEW.id) IN (
            'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
            'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
            'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile'
          )
       OR (NEW.hostname IS NOT NULL AND lower(NEW.hostname) IN (
            'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
            'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
            'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile'
          ));
END;

-- 3. Same guard on UPDATE of id/hostname, so an existing row can never be
--    retargeted onto a reserved name either.
CREATE TRIGGER IF NOT EXISTS app_listings_reserved_hostname_guard_update
BEFORE UPDATE OF hostname, id ON app_listings
BEGIN
    SELECT RAISE(ABORT, 'reserved app id/hostname cannot be used for app_listings')
    WHERE lower(NEW.id) IN (
            'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
            'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
            'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile'
          )
       OR (NEW.hostname IS NOT NULL AND lower(NEW.hostname) IN (
            'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
            'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
            'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile'
          ));
END;
