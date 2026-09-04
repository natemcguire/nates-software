PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN repository_id TEXT REFERENCES repositories(id);

CREATE INDEX IF NOT EXISTS idx_app_listings_repository ON app_listings(repository_id);

UPDATE app_listings
SET repository_id = (
  SELECT r.id FROM repositories r
  WHERE r.app_id = app_listings.id
  ORDER BY (CASE WHEN r.status = 'active' THEN 0 ELSE 1 END), r.created_at ASC
  LIMIT 1
)
WHERE repository_id IS NULL;
