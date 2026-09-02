-- 0036_launch_honesty_cleanup.sql
--
-- Pre-launch honesty pass. Migration 0001 seeded the prod catalog with fabricated
-- engagement (upvotes/forks), invented quality scores, a stock-photo screenshot, a
-- false capability claim, seeded "testimonial" comments with invented upvotes, and a
-- user impersonating a real public figure with a verified badge. With no real users
-- yet, none of that is true — and a source-reading Hacker News audience catches every
-- one of these in the first five minutes. This migration makes the seeded catalog
-- tell the truth. It mirrors the honest 0/0 seeding already used for wallart and
-- american-gardener (0021) and the truthful-copy pattern of 0017 (picfit).
--
-- Idempotent: every statement is a guarded UPDATE/DELETE keyed by stable ids, so it is
-- a no-op on a fresh preview DB that never carried the 0001 seed rows.

PRAGMA foreign_keys = ON;

-- 1) Zero the fabricated engagement on the 0001-seeded apps. We have no users; there
--    are no real upvotes or forks. (wallart/american-gardener were already seeded 0/0.)
UPDATE app_listings
SET upvotes = 0,
    forks = 0
WHERE id IN ('dronehunter', 'certified-mailer', 'picfitai');

-- 2) Replace invented quality metrics ("99.9% clean", moddability 98/96/95) with the
--    honest "not yet benchmarked" state the newer listings already use. These ship in
--    the public /api/drops JSON, so an invented score sitting next to honest
--    "Not yet benchmarked" rows is itself the tell.
UPDATE app_listings
SET merge_cleanliness = 'Not yet benchmarked'
WHERE id IN ('dronehunter', 'certified-mailer', 'picfitai');

-- 3) Certified Mailer: the seeded 0001 copy claims it "generates official 20-digit USPS
--    Certified Mail barcodes, Electronic Return Receipt (ERR) tracking" — a false
--    capability claim on a paid $15 tool that is actually a browser-local drafting +
--    evidence journal. Replace with the honest copy already written in mockData.ts.
UPDATE app_listings
SET tagline = 'Private letter preparation and a user-recorded mailing-evidence journal',
    description = 'Prepare, review, print, and locally journal important correspondence. Postal tracking and receipt observations are entered by you and remain explicitly unverified — the app does not submit mail or validate postal status.'
WHERE id = 'certified-mailer';

-- 4) Replace the Unsplash stock-photo "screenshots" (dronehunter + certified-mailer,
--    seeded in 0001) with none. An empty screenshot set renders an honest empty state;
--    a borrowed stock photo passed off as the product is a classic tell. dronehunter's
--    real in-repo screenshot is served separately by the live app.
UPDATE app_listings
SET screenshots = '[]'
WHERE id IN ('certified-mailer', 'picfitai');
UPDATE app_listings
SET screenshots = '["/dronehunter-ephemeral-screenshot.png"]'
WHERE id = 'dronehunter';

-- 5) Delete the fabricated "testimonial" comments seeded in 0001 (invented text with
--    invented upvotes 24/19/15). We have no users; there is no discussion yet.
DELETE FROM comments WHERE id IN ('c101', 'c102', 'c103');

-- 6) The seeded user 'usr_sam' was "Sam Altman" with is_verified_maker=1 — impersonating
--    a real public figure AND wearing a verified badge. We cannot hard-DELETE the row
--    (it may be referenced by lineage/session FKs), so we de-impersonate it: a clearly
--    fictional demo maker, no verified badge. (usr_nate and usr_josh are the real
--    founders and are left intact.)
UPDATE users
SET display_name = 'Sam (demo maker)',
    bio = 'Example maker account seeded for demos.',
    is_verified_maker = 0
WHERE id = 'usr_sam' AND display_name = 'Sam Altman';

-- 7) Retire the internal CI / deploy-gate fixture apps from the PUBLIC catalog. These
--    are created at runtime by the deploy pipeline (hello-python, hello-pg, hello-pg2,
--    hello-next) plus the build-in-public log (live-build); they are not shareware and
--    they dominate the auto-opened SETUP.EXE "pick an app" list and the HOTWIRE board,
--    making the marketplace read as a Potemkin CI dashboard. Retire (don't delete —
--    their deployments and lineage stay valid), so both surfaces show only real apps.
--    No-op on any DB where these listings don't exist.
UPDATE app_listings
SET listing_status = 'retired'
WHERE id IN ('hello-python', 'hello-pg', 'hello-pg2', 'hello-next', 'live-build');
