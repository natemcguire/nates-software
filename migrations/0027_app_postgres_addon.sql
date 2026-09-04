PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN db_kind TEXT
  CHECK (db_kind IS NULL OR db_kind IN ('postgres'));

ALTER TABLE app_listings ADD COLUMN db_secret_path TEXT;

ALTER TABLE app_listings ADD COLUMN db_provisioned_at TIMESTAMP;
