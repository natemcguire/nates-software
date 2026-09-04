PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN origin_kind TEXT DEFAULT 'r2_static'
  CHECK (origin_kind IN ('r2_static', 'worker', 'cf_container', 'fargate_warm'));

ALTER TABLE app_listings ADD COLUMN origin_ref TEXT;

ALTER TABLE app_listings ADD COLUMN hostname TEXT;

CREATE INDEX IF NOT EXISTS idx_app_listings_hostname ON app_listings(hostname);

UPDATE app_listings
SET hostname = id
WHERE hostname IS NULL;

UPDATE app_listings
SET origin_kind = 'r2_static'
WHERE origin_kind IS NULL;
