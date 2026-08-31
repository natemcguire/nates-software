-- Migration 0025: Host resolution and origin dispatch metadata for app_listings.
-- Invariants:
-- 1. origin_kind represents the execution/hosting environment ('r2_static', 'worker', 'cf_container', 'fargate_warm').
-- 2. origin_ref holds an optional target reference (e.g. worker script name, container ARN, endpoint).
-- 3. hostname holds the custom subdomain or routing label (defaults/backfills to id).

PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN origin_kind TEXT DEFAULT 'r2_static'
  CHECK (origin_kind IN ('r2_static', 'worker', 'cf_container', 'fargate_warm'));

ALTER TABLE app_listings ADD COLUMN origin_ref TEXT;

ALTER TABLE app_listings ADD COLUMN hostname TEXT;

CREATE INDEX IF NOT EXISTS idx_app_listings_hostname ON app_listings(hostname);

-- Backfill hostname = id for existing rows
UPDATE app_listings
SET hostname = id
WHERE hostname IS NULL;

-- Backfill origin_kind = 'r2_static' for existing rows
UPDATE app_listings
SET origin_kind = 'r2_static'
WHERE origin_kind IS NULL;
