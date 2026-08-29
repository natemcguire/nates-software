-- Replace PicFit's retired simulated AI try-on copy with the shipped local image utility.
-- The stable app id remains picfitai so existing licenses, forks, and links keep working.
UPDATE app_listings
SET name = 'PicFit',
    tagline = 'Private in-browser crop, resize, compression, and image export studio',
    description = 'Prepare JPEG, PNG, and WebP images locally with crop presets, exact output dimensions, real encoded-size reporting, and downloads that never require an upload.',
    tags = '["Images","Crop","Resize","Compression","Local-First"]',
    binaries = '{"web":"https://picfitai.nates-software.com"}'
WHERE id = 'picfitai';
