PRAGMA foreign_keys = ON;

UPDATE app_listings
SET upvotes = 0,
    forks = 0
WHERE id IN ('dronehunter', 'certified-mailer', 'picfitai');

UPDATE app_listings
SET merge_cleanliness = 'Not yet benchmarked'
WHERE id IN ('dronehunter', 'certified-mailer', 'picfitai');

UPDATE app_listings
SET tagline = 'Private letter preparation and a user-recorded mailing-evidence journal',
    description = 'Prepare, review, print, and locally journal important correspondence. Postal tracking and receipt observations are entered by you and remain explicitly unverified — the app does not submit mail or validate postal status.'
WHERE id = 'certified-mailer';

UPDATE app_listings
SET screenshots = '[]'
WHERE id IN ('certified-mailer', 'picfitai');
UPDATE app_listings
SET screenshots = '["/dronehunter-ephemeral-screenshot.png"]'
WHERE id = 'dronehunter';

DELETE FROM comments WHERE id IN ('c101', 'c102', 'c103');

UPDATE users
SET display_name = 'Sam (demo maker)',
    bio = 'Example maker account seeded for demos.',
    is_verified_maker = 0
WHERE id = 'usr_sam' AND display_name = 'Sam Altman';

UPDATE app_listings
SET listing_status = 'retired'
WHERE id IN ('hello-python', 'hello-pg', 'hello-pg2', 'hello-next', 'live-build');
