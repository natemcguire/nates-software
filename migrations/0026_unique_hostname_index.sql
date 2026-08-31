-- Migration 0026: Unique index on app_listings.hostname for deterministic host routing.
-- Note: apply only after confirming no duplicate hostnames exist in prod.

PRAGMA foreign_keys = ON;

-- Drop non-unique index from migration 0025 if exists
DROP INDEX IF EXISTS idx_app_listings_hostname;

-- Create unique index on hostname to enforce 1:1 hostname mapping
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_listings_hostname_unique ON app_listings(hostname);
