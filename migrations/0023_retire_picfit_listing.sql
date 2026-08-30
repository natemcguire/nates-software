-- 0023_retire_picfit_listing.sql
-- Remove picfit/picfitai from the live catalog.
-- picfit is dropped from the Nate's Software demo set. Migration 0022 already set its
-- deployment_state='retired'; this also retires the LISTING itself so GET /api/drops
-- (which filters listing_status='active') no longer surfaces it.
-- The row is retained (not deleted) so existing licenses/shelf_items/forge links keep
-- their FK integrity; it is simply no longer an active catalog listing.

UPDATE app_listings
SET listing_status = 'retired',
    deployment_state = 'retired'
WHERE id = 'picfitai';
