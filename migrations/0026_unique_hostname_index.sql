PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_app_listings_hostname;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_listings_hostname_unique ON app_listings(hostname);
