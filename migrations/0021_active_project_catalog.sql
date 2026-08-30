-- Rotate the active showcase without erasing historical licenses or lineage.
PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN listing_status TEXT NOT NULL DEFAULT 'active'
  CHECK (listing_status IN ('active', 'retired'));

UPDATE app_listings SET listing_status = 'retired' WHERE id = 'picfitai';

INSERT OR IGNORE INTO app_listings
  (id,name,tagline,description,creator_id,upvotes,forks,version,license,price,
   moddability_score,merge_cleanliness,storage,screenshots,binaries,tags,listing_status)
VALUES
  ('wallart','WallArt Studio','Private tenant-isolated photo-to-art and print workflow.',
   'A private multi-tenant photo-to-art studio with durable generation jobs, private originals, print variants, and user-owned model credentials.',
   'usr_nate',0,0,'v0.1.0','Private Shareware','$59.00',96,'Not yet benchmarked',
   'Application-owned Cloudflare D1 and private R2','[]','{}',
   '["Wall Art","Cloudflare","D1","R2","Queues","Tenant Isolation"]','active'),
  ('american-gardener','American Gardener','Local garden operations, crop timing, light, and inventory intelligence.',
   'A private local dashboard combining crop and growing-degree-day targets, garden-spot light readings, inventory, and optional Home Assistant observations.',
   'usr_nate',0,0,'v1.0.0','Private Local-First Shareware','$25.00',94,'Not yet benchmarked',
   'Application-owned private local SQLite','[]','{}',
   '["Gardening","SQLite","Home Assistant","GDD","DLI","Local-First"]','active');

UPDATE app_listings SET listing_status = 'active' WHERE id IN ('wallart','american-gardener');
