-- Migration 0027: Add Postgres add-on columns to app_listings.
-- Invariants:
-- 1. db_kind represents the database backend ('postgres' or NULL).
-- 2. db_secret_path stores the SSM SecureString parameter path (/nsw/apps/<id>/db-url).
-- 3. db_provisioned_at records the timestamp when the database add-on was provisioned.

PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN db_kind TEXT
  CHECK (db_kind IS NULL OR db_kind IN ('postgres'));

ALTER TABLE app_listings ADD COLUMN db_secret_path TEXT;

ALTER TABLE app_listings ADD COLUMN db_provisioned_at TIMESTAMP;
