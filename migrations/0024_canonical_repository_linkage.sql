-- Migration 0024: Link app_listings to its canonical GITSMITH repository.
-- Invariants:
-- 1. app_listings.repository_id provides an explicit forward foreign key to repositories(id).
-- 2. Legacy rows can link bidirectionally via repositories.app_id = app_listings.id.
-- 3. Enables direct card rendering of canonical repo identity and atomic fork resolution.

PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN repository_id TEXT REFERENCES repositories(id);

CREATE INDEX IF NOT EXISTS idx_app_listings_repository ON app_listings(repository_id);

-- Link any existing repositories that have app_id pointing to app_listings
UPDATE app_listings
SET repository_id = (
  SELECT r.id FROM repositories r
  WHERE r.app_id = app_listings.id
  ORDER BY (CASE WHEN r.status = 'active' THEN 0 ELSE 1 END), r.created_at ASC
  LIMIT 1
)
WHERE repository_id IS NULL;
